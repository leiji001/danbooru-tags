const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiOptions {
	apiKey: string;
	model?: string;
	maxRetries?: number;
	baseDelay?: number;
}

interface GeminiResponse {
	text: string;
}

function isRetryable(status: number): boolean {
	return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(
	prompt: string,
	options: GeminiOptions,
	attempt: number,
): Promise<GeminiResponse> {
	const { apiKey, model = "gemma-4-26b-a4b-it" } = options;

	const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`;
	const body = JSON.stringify({
		contents: [{ parts: [{ text: prompt }] }],
	});

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
		candidates?: { content?: { parts?: { text?: string }[] } }[];
	};

	const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
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
			return await callGemini(prompt, options, attempt);
		} catch (err) {
			if (attempt === maxRetries) throw err;
			const wait = baseDelay * 2 ** attempt;
			await delay(wait);
		}
	}

	throw new Error("Unreachable");
}
