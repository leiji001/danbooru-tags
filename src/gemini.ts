import { GoogleGenAI } from "@google/genai/web";

export interface GeminiOptions {
	apiKey: string;
	model?: string;
	maxRetries?: number;
	baseDelay?: number;
}

export interface GeminiResponse {
	text: string;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(
	prompt: string,
	options: GeminiOptions,
): Promise<GeminiResponse> {
	const { apiKey, model = "gemma-4-26b-a4b-it" } = options;
	const ai = new GoogleGenAI({ apiKey });

	const response = await ai.models.generateContent({
		model,
		contents: prompt,
	});

	const text = response.text;
	if (!text) {
		throw new Error("Gemini API returned no text");
	}

	return { text };
}

export async function geminiGenerate(
	prompt: string,
	options: GeminiOptions,
): Promise<GeminiResponse> {
	const { maxRetries = 8, baseDelay = 1000 } = options;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await callGemini(prompt, options);
		} catch (err) {
			if (attempt === maxRetries) throw err;
			const wait = baseDelay * 2 ** attempt;
			await delay(wait);
		}
	}

	throw new Error("Unreachable");
}

export interface StreamCallbacks {
	onChunk?: (text: string) => void;
	onRetry?: (attempt: number, maxRetries: number, error: string) => void;
}

async function callGeminiStream(
	prompt: string,
	options: GeminiOptions & StreamCallbacks,
): Promise<GeminiResponse> {
	const { apiKey, model = "gemma-4-26b-a4b-it" } = options;
	const ai = new GoogleGenAI({ apiKey });

	const stream = await ai.models.generateContentStream({
		model,
		contents: prompt,
	});

	let fullText = "";
	for await (const chunk of stream) {
		const text = chunk.text;
		if (text) {
			fullText += text;
			options.onChunk?.(fullText);
		}
	}

	if (!fullText) throw new Error("Gemini API returned no text");
	return { text: fullText };
}

export async function geminiGenerateStream(
	prompt: string,
	options: GeminiOptions & StreamCallbacks,
): Promise<GeminiResponse> {
	const { maxRetries = 8, baseDelay = 1000 } = options;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			if (attempt > 0) {
				options.onRetry?.(attempt, maxRetries, "");
			}
			return await callGeminiStream(prompt, options);
		} catch (err) {
			if (attempt === maxRetries) throw err;
			const wait = baseDelay * 2 ** attempt;
			options.onRetry?.(attempt + 1, maxRetries, String(err));
			await delay(wait);
		}
	}

	throw new Error("Unreachable");
}
