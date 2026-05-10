/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { translatePrompt, rewritePrompt, translatePromptStream, rewritePromptStream } from "./prompt";

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/message':
				return new Response('Hello, World!');
			case '/random':
				return new Response(crypto.randomUUID());
			case '/api/translate': {
				if (request.method !== 'POST') {
					return new Response('Method Not Allowed', { status: 405 });
				}
				try {
					const body = await request.json() as Record<string, unknown>;
					const prompt = String(body.prompt || '');
					if (!prompt) {
						return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
					}
					const result = await translatePrompt({
						prompt,
						negative_prompt: body.negative_prompt ? String(body.negative_prompt) : undefined,
						apiKey: String(body.apiKey || env.GEMINI_API_KEY || ''),
					});
					return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
				} catch (e) {
					return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
				}
			}
			case '/api/rewrite': {
				if (request.method !== 'POST') {
					return new Response('Method Not Allowed', { status: 405 });
				}
				try {
					const body = await request.json() as Record<string, unknown>;
					const prompt = String(body.prompt || '');
					const original_prompt = String(body.original_prompt || '');
					if (!prompt || !original_prompt) {
						return new Response(JSON.stringify({ error: 'prompt and original_prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
					}
					const result = await rewritePrompt({
						prompt,
						original_prompt,
						negative_prompt: body.negative_prompt ? String(body.negative_prompt) : undefined,
						apiKey: String(body.apiKey || env.GEMINI_API_KEY || ''),
					});
					return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
				} catch (e) {
					return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
				}
			}
			case '/api/stream': {
				if (request.method !== 'POST') {
					return new Response('Method Not Allowed', { status: 405 });
				}
				try {
					const body = await request.json() as Record<string, unknown>;
					const mode = String(body.mode || 'translate');
					const prompt = String(body.prompt || '');
					const apiKey = String(body.apiKey || env.GEMINI_API_KEY || '');

					if (!prompt) {
						return new Response(JSON.stringify({ error: 'prompt required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
					}
					if (mode === 'rewrite') {
						const original_prompt = String(body.original_prompt || '');
						if (!original_prompt) {
							return new Response(JSON.stringify({ error: 'original_prompt required for rewrite mode' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
						}
					}

					const encoder = new TextEncoder();
					const stream = new ReadableStream({
						async start(controller) {
							const send = (event: string, data: unknown) => {
								controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
							};

							try {
								send('status', { status: 'generating' });

								const onRetry = (attempt: number, maxRetries: number, error: string) => {
									send('retry', { attempt, maxRetries, message: error });
								};
								const onChunk = (text: string) => {
									send('chunk', { text });
								};

								let result;
								if (mode === 'rewrite') {
									result = await rewritePromptStream({
										prompt,
										original_prompt: String(body.original_prompt || ''),
										negative_prompt: body.negative_prompt ? String(body.negative_prompt) : undefined,
										apiKey,
										onChunk,
										onRetry,
									});
								} else {
									result = await translatePromptStream({
										prompt,
										negative_prompt: body.negative_prompt ? String(body.negative_prompt) : undefined,
										apiKey,
										onChunk,
										onRetry,
									});
								}

								send('status', { status: 'done' });
								send('result', result);
							} catch (e) {
								send('status', { status: 'error' });
								send('error', { message: String(e) });
							} finally {
								controller.close();
							}
						},
					});

					return new Response(stream, {
						headers: {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache',
							'Connection': 'keep-alive',
						},
					});
				} catch (e) {
					return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
				}
			}
			default:
				return new Response('Not Found', { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;
