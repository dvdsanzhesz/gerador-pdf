/**
 * POST /api/generate
 * Body: { mode: "vol1"|"vol2"|"vol3"|"temas", courseName, tema?, aulas:[{titulo?, texto}], model? }
 * Chama a API da Anthropic com streaming e repassa o stream (SSE) para o navegador.
 * Requer a variável de ambiente ANTHROPIC_API_KEY (Settings do projeto no Cloudflare Pages).
 */
import { buildPrompt } from '../../prompts.js';

const MODELO_PADRAO = 'claude-fable-5';

export async function onRequestPost(context) {
  const erro = (msg, status = 400) =>
    new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });

  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return erro('ANTHROPIC_API_KEY não configurada. No Cloudflare Pages: Settings → Variables and Secrets → adicione ANTHROPIC_API_KEY.', 500);
  }

  let body;
  try { body = await context.request.json(); } catch { return erro('JSON inválido'); }

  const { mode, courseName, tema, aulas, model } = body || {};
  if (!mode || !['vol1', 'vol2', 'vol3', 'temas'].includes(mode)) return erro('mode inválido');
  if (!Array.isArray(aulas) || !aulas.length || !aulas.some(a => a && a.texto && a.texto.trim().length > 50)) {
    return erro('Nenhuma transcrição de aula recebida.');
  }
  if (mode === 'vol2' && !tema) return erro('Escolha ou digite um tema para o Volume 2.');

  const prompt = buildPrompt({ mode, courseName, tema, aulas });

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: model || context.env.CLAUDE_MODEL || MODELO_PADRAO,
      max_tokens: prompt.maxTokens,
      stream: true,
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }]
    })
  });

  if (!upstream.ok) {
    let detalhe = '';
    try { detalhe = (await upstream.json())?.error?.message || ''; } catch { /* ignore */ }
    return erro(`Erro da API Anthropic (${upstream.status}): ${detalhe || 'verifique a chave e o modelo.'}`, 502);
  }

  // Repassa o SSE da Anthropic direto para o navegador
  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
}
