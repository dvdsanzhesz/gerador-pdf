/**
 * Entrada para deploy como Cloudflare WORKER (com assets estáticos).
 * Reaproveita as mesmas rotas do formato Pages (functions/api/*).
 * - POST /api/transcript → extrai transcrição do YouTube
 * - POST /api/generate   → gera a apostila via API da Anthropic (modo automático)
 * - resto               → arquivos estáticos do site
 */
import { onRequestPost as transcriptPost } from './functions/api/transcript.js';
import { onRequestPost as generatePost } from './functions/api/generate.js';
import { onRequestPost as gammaPost } from './functions/api/gamma.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // Teste rápido: abra /api/status no navegador — se responder ok, o motor está ligado
    if (pathname === '/api/status') {
      return new Response(JSON.stringify({ ok: true, motor: 'ligado', formato: 'worker' }), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }

    if (pathname === '/api/transcript' && request.method === 'POST') {
      return transcriptPost({ request, env });
    }
    if (pathname === '/api/generate' && request.method === 'POST') {
      return generatePost({ request, env });
    }
    if (pathname === '/api/gamma' && request.method === 'POST') {
      return gammaPost({ request, env });
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ ok: false, error: 'Rota não encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      });
    }
    return env.ASSETS.fetch(request);
  }
};
