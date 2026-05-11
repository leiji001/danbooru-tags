const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "models/gemma-4-31b-it";
const MAX_RETRIES = 8;
const RETRY_DELAY = 500;

export interface GeminiOptions {
	apiKey: string;
	systemInstruction?: string;
	model?: string;
}

export interface GeminiResult {
	text: string;
	thoughts: string;
}

export interface StreamCallbacks {
	onChunk?: (text: string) => void;
	onRetry?: (attempt: number, maxRetries: number, error: string) => void;
}

interface GeminiPart {
	text?: string;
	thought?: boolean;
}

interface GeminiContent {
	parts: GeminiPart[];
}

interface GeminiCandidate {
	content: GeminiContent;
}

interface GeminiResponse {
	candidates: GeminiCandidate[];
}

function buildBody(userPrompt: string, options: GeminiOptions): Record<string, unknown> {
	const body: Record<string, unknown> = {
		contents: [{ parts: [{ text: userPrompt }], role: "user" }],
		generationConfig: {
			thinkingConfig: { includeThoughts: true },
		},
	};
	if (options.systemInstruction) {
		body.systemInstruction = {
			parts: [{ text: options.systemInstruction }],
		};
	}
	return body;
}

function extractParts(data: GeminiResponse): GeminiResult {
	const parts = data.candidates?.[0]?.content?.parts ?? [];
	const textParts: string[] = [];
	const thoughtParts: string[] = [];
	for (const part of parts) {
		if (!part.text) continue;
		if (part.thought) {
			thoughtParts.push(part.text);
		} else {
			textParts.push(part.text);
		}
	}
	return { text: textParts.join(""), thoughts: thoughtParts.join("") };
}

/** 普通请求 */
export async function geminiGenerate(
	userPrompt: string,
	options: GeminiOptions,
): Promise<GeminiResult> {
	const model = options.model || DEFAULT_MODEL;
	const url = `${BASE_URL}/${model}:generateContent`;
	const body = buildBody(userPrompt, options);

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const resp = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": options.apiKey,
			},
			body: JSON.stringify(body),
		});

		if (resp.status === 500) {
			if (attempt < MAX_RETRIES) {
				await new Promise(r => setTimeout(r, RETRY_DELAY));
				continue;
			}
			throw new Error(`Gemini API 500 after ${MAX_RETRIES} retries`);
		}

		if (resp.status === 400) {
			const errText = await resp.text();
			throw new Error(errText);
		}

		if (!resp.ok) {
			const errText = await resp.text();
			throw new Error(errText);
		}

		return extractParts(await resp.json() as GeminiResponse);
	}
	throw new Error("unreachable");
}

/** 流式请求 */
export async function geminiGenerateStream(
	userPrompt: string,
	options: GeminiOptions & StreamCallbacks,
): Promise<GeminiResult> {
	const model = options.model || DEFAULT_MODEL;
	const url = `${BASE_URL}/${model}:streamGenerateContent`;
	const body = buildBody(userPrompt, options);
	const { onChunk, onRetry } = options;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const resp = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": options.apiKey,
			},
			body: JSON.stringify(body),
		});

		if (resp.status === 500) {
			if (attempt < MAX_RETRIES) {
				onRetry?.(attempt + 1, MAX_RETRIES, "HTTP 500");
				await new Promise(r => setTimeout(r, RETRY_DELAY));
				continue;
			}
			throw new Error(`Gemini API 500 after ${MAX_RETRIES} retries`);
		}

		if (resp.status === 400) {
			const errText = await resp.text();
			throw new Error(errText);
		}

		if (!resp.ok) {
			const errText = await resp.text();
			throw new Error(errText);
		}

		const reader = resp.body!.getReader();
		const decoder = new TextDecoder();
		const textParts: string[] = [];
		const thoughtParts: string[] = [];
		let buffer = "";

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || !trimmed.startsWith("data:")) continue;
				const jsonStr = trimmed.slice(5).trim();
				if (!jsonStr || jsonStr === "[DONE]") continue;
				try {
					const chunk = JSON.parse(jsonStr) as GeminiResponse;
					for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
						if (!part.text) continue;
						if (part.thought) {
							thoughtParts.push(part.text);
						} else {
							textParts.push(part.text);
							onChunk?.(part.text);
						}
					}
				} catch { /* skip malformed JSON */ }
			}
		}

		return { text: textParts.join(""), thoughts: thoughtParts.join("") };
	}
	throw new Error("unreachable");
}
