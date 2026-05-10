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

import { translatePrompt, rewritePrompt } from "./prompt";

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
			default:
				return new Response('Not Found', { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;
