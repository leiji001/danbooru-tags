const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "models/gemma-4-31b-it";
const MAX_RETRIES = 8;
const RETRY_DELAY = 500;

export interface GeminiOptions {
	apiKey: string;
	model?: string;
	thinkingBudget?: number;
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
	finishReason?: string;
	safetyRatings?: Array<{ category?: string; probability?: string }>;
	content: GeminiContent;
}

interface GeminiResponse {
	candidates: GeminiCandidate[];
	promptFeedback?: {
		blockReason?: string;
		blockReasonMessage?: string;
		safetyRatings?: Array<{ category?: string; probability?: string }>;
	};
}

function formatSafetyRatings(
	ratings?: Array<{ category?: string; probability?: string }>,
): string {
	if (!ratings?.length) return "";
	return ratings
		.map(r => `${r.category || "UNKNOWN"}:${r.probability || "UNKNOWN"}`)
		.join(", ");
}

function throwIfBlocked(data: GeminiResponse): void {
	const feedback = data.promptFeedback;
	if (feedback?.blockReason) {
		const ratings = formatSafetyRatings(feedback.safetyRatings);
		const message = feedback.blockReasonMessage || "Prompt blocked by safety review";
		throw new Error(
			`Gemini prompt blocked (${feedback.blockReason}): ${message}${ratings ? ` | safetyRatings=${ratings}` : ""}`,
		);
	}

	const candidate = data.candidates?.[0];
	if (!candidate) {
		throw new Error("Gemini returned no candidates");
	}

	if (!candidate.content?.parts?.length && candidate.finishReason) {
		const ratings = formatSafetyRatings(candidate.safetyRatings);
		throw new Error(
			`Gemini returned empty candidate (finishReason=${candidate.finishReason})${ratings ? ` | safetyRatings=${ratings}` : ""}`,
		);
	}
}

const SAFETY_OFF = [
	{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
	{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
];

function buildBody(finalPrompt: string, options: GeminiOptions): Record<string, unknown> {
	const generationConfig: Record<string, unknown> = {
		temperature: 0.7,
		maxOutputTokens: 1024,
	};
	if (typeof options.thinkingBudget === "number") {
		generationConfig.thinkingConfig = { thinkingBudget: options.thinkingBudget };
	}
	return {
		contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
		safetySettings: SAFETY_OFF,
		generationConfig,
	};
}

function extractParts(data: GeminiResponse): GeminiResult {
	throwIfBlocked(data);
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

export async function geminiGenerate(
	finalPrompt: string,
	options: GeminiOptions,
): Promise<GeminiResult> {
	const model = options.model || DEFAULT_MODEL;
	const url = `${BASE_URL}/${model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
	const body = buildBody(finalPrompt, options);

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const resp = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
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
		if (!resp.ok) throw new Error(await resp.text());
		return extractParts(await resp.json() as GeminiResponse);
	}
	throw new Error("unreachable");
}

export async function geminiGenerateStream(
	finalPrompt: string,
	options: GeminiOptions & StreamCallbacks,
): Promise<GeminiResult> {
	const model = options.model || DEFAULT_MODEL;
	const url = `${BASE_URL}/${model}:streamGenerateContent?key=${encodeURIComponent(options.apiKey)}`;
	const body = buildBody(finalPrompt, options);
	const { onChunk, onRetry } = options;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const resp = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
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
		if (!resp.ok) throw new Error(await resp.text());

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
				} catch {
					// ignore malformed line
				}
			}
		}

		const final = { candidates: [{ content: { parts: [] } }] } as GeminiResponse;
		if (!textParts.length && !thoughtParts.length) {
			throwIfBlocked(final);
		}
		return { text: textParts.join(""), thoughts: thoughtParts.join("") };
	}
	throw new Error("unreachable");
}
