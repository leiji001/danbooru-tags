const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiOptions {
	apiKey: string;
	model?: string;
	systemInstruction?: string;
	maxRetries?: number;
	baseDelay?: number;
	thinkingBudget?: number;
}

interface GeminiResponse {
	text: string;
	thought?: string;
}

function isRetryable(status: number): boolean {
	return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractTextAndThought(data: {
	candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}): GeminiResponse {
	const parts = data.candidates?.[0]?.content?.parts;
	if (!parts) throw new Error("Gemini API returned no content");

	let text = "";
	let thought = "";
	for (const part of parts) {
		if (part.thought) {
			thought += part.text || "";
		} else {
			text += part.text || "";
		}
	}

	if (!text && !thought) throw new Error("Gemini API returned no text");

	return { text: text || thought, thought: thought || undefined };
}

async function callGemini(
	prompt: string,
	options: GeminiOptions,
	attempt: number,
): Promise<GeminiResponse> {
	const { apiKey, model = "gemini-2.5-flash", systemInstruction, thinkingBudget = 4096 } = options;

	const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
	const reqBody: Record<string, unknown> = {
		contents: [{ parts: [{ text: prompt }] }],
		generationConfig: {
			thinkingConfig: { thinkingBudget },
		},
	};
	if (systemInstruction) {
		reqBody.systemInstruction = { parts: [{ text: systemInstruction }] };
	}
	const body = JSON.stringify(reqBody);

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});

	if (!response.ok && isRetryable(response.status)) {
		throw new Error(`Retryable: HTTP ${response.status}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error ${response.status}: ${errorText}`);
	}

	const data = (await response.json()) as {
		candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
	};

	return extractTextAndThought(data);
}

export async function geminiGenerate(
	prompt: string,
	options: GeminiOptions,
): Promise<GeminiResponse> {
	const { maxRetries = 8, baseDelay = 1000 } = options;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await callGemini(prompt, options, attempt);
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
	const { apiKey, model = "gemini-2.5-flash", systemInstruction, thinkingBudget = 4096 } = options;

	const url = `${GEMINI_API_BASE}/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;
	const reqBody: Record<string, unknown> = {
		contents: [{ parts: [{ text: prompt }] }],
		generationConfig: {
			thinkingConfig: { thinkingBudget },
		},
	};
	if (systemInstruction) {
		reqBody.systemInstruction = { parts: [{ text: systemInstruction }] };
	}
	const body = JSON.stringify(reqBody);

	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});

	if (!response.ok && isRetryable(response.status)) {
		throw new Error(`Retryable: HTTP ${response.status}`);
	}

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Gemini API error ${response.status}: ${errorText}`);
	}

	const reader = response.body?.getReader();
	if (!reader) throw new Error("No response body from Gemini stream");

	const decoder = new TextDecoder();
	let fullText = "";
	let thoughtText = "";
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line.startsWith("data: ")) continue;
			const jsonStr = line.slice(6).trim();
			if (!jsonStr) continue;
			try {
				const data = JSON.parse(jsonStr);
				const parts = data.candidates?.[0]?.content?.parts;
				if (!parts) continue;
				for (const part of parts) {
					if (part.text) {
						if (part.thought) {
							thoughtText += part.text;
						} else {
							fullText += part.text;
						}
					}
				}
				options.onChunk?.(fullText);
			} catch {
				// skip unparseable chunks
			}
		}
	}

	if (!fullText && !thoughtText) throw new Error("Gemini API returned no text");
	return { text: fullText || thoughtText, thought: thoughtText || undefined };
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
