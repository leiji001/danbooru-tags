import { translatePrompt, rewritePrompt, translatePromptStream, rewritePromptStream, type PromptParams } from "./prompt";
import type { StreamCallbacks } from "./gemini";

// ========== 工具函数 ==========

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
	const ct = request.headers.get("Content-Type") || "";
	if (!ct.includes("application/json")) {
		throw new Error("Content-Type must be application/json");
	}
	const raw = await request.json() as Record<string, unknown>;
	if (!raw || typeof raw !== "object") throw new Error("Invalid JSON body");
	return raw;
}

function extractParams(body: Record<string, unknown>, env: Env): PromptParams {
	const prompt = String(body.prompt || "").trim();
	if (!prompt) throw new Error("prompt required");

	const apiKey = env as unknown as { GEMINI_API_KEY?: string };
	return {
		prompt,
		original_prompt: body.original_prompt ? String(body.original_prompt).trim() : undefined,
		negative_prompt: body.negative_prompt ? String(body.negative_prompt).trim() : undefined,
		apiKey: "apiKey" in body ? String(body.apiKey) : String(apiKey.GEMINI_API_KEY || ""),
	};
}

// ========== 路由处理 ==========

async function handleTranslate(body: Record<string, unknown>, env: Env): Promise<Response> {
	const params = extractParams(body, env);
	const result = await translatePrompt(params);
	return json(result);
}

async function handleRewrite(body: Record<string, unknown>, env: Env): Promise<Response> {
	const params = extractParams(body, env);
	if (!params.original_prompt) return json({ error: "original_prompt required" }, 400);
	const result = await rewritePrompt(params);
	return json(result);
}

async function handleStream(body: Record<string, unknown>, env: Env): Promise<Response> {
	const mode = String(body.mode || "translate");
	const params = extractParams(body, env);
	if (mode === "rewrite" && !params.original_prompt) {
		return json({ error: "original_prompt required for rewrite mode" }, 400);
	}

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (event: string, data: unknown) => {
				controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
			};
			try {
				send("status", { status: "generating" });
				const callbacks: StreamCallbacks = {
					onChunk: (text: string) => send("chunk", { text }),
					onRetry: (attempt, maxRetries, message) => send("retry", { attempt, maxRetries, message }),
				};
				const result = mode === "rewrite"
					? await rewritePromptStream({ ...params, ...callbacks })
					: await translatePromptStream({ ...params, ...callbacks });
				send("status", { status: "done" });
				send("result", result);
			} catch (e) {
				send("status", { status: "error" });
				send("error", { message: String(e) });
			} finally {
				controller.close();
			}
		},
	});

	return new Response(stream, {
		headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", ...CORS_HEADERS },
	});
}

// ========== 路由表 ==========

type Handler = (body: Record<string, unknown>, env: Env) => Promise<Response>;
const routes: Record<string, { method: string; handler: Handler }> = {
	"/api/translate": { method: "POST", handler: handleTranslate },
	"/api/rewrite": { method: "POST", handler: handleRewrite },
	"/api/stream": { method: "POST", handler: handleStream },
};

// ========== Worker ==========

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}

		const url = new URL(request.url);
		const route = routes[url.pathname];

		if (!route) return json({ error: "Not Found" }, 404);
		if (request.method !== route.method) return json({ error: "Method Not Allowed" }, 405);

		try {
			const body = await parseBody(request);
			return await route.handler(body, env);
		} catch (e) {
			const message = String(e);
			const status = message.includes("required") || message.includes("Invalid") || message.includes("Content-Type") ? 400 : 500;
			return json({ error: message }, status);
		}
	},
} satisfies ExportedHandler<Env>;
