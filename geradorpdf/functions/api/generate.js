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

  let body;
  try { body = await context.request.json(); } catch { return erro('JSON inválido'); }

  const { mode, courseName, tema, aulas, model, engine } = body || {};
  if (!mode || !['vol1', 'vol2', 'vol3', 'temas'].includes(mode)) return erro('mode inválido');
  if (!Array.isArray(aulas) || !aulas.length || !aulas.some(a => a && a.texto && a.texto.trim().length > 50)) {
    return erro('Nenhuma transcrição de aula recebida.');
  }
  if (mode === 'vol2' && !tema) return erro('Escolha ou digite um tema para o Volume 2.');

  const prompt = buildPrompt({ mode, courseName, tema, aulas });

  /* ============ Motor GEMINI (grátis — "tudo no site") ============ */
  if (engine === 'gemini') {
    const gKey = String(body.gemini || context.env.GEMINI_API_KEY || '').trim();
    if (!gKey) return erro('Chave do Gemini não configurada. Cole sua chave gratuita em ⚙ Configurações (aistudio.google.com/apikey).');

    const gPayload = JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system }] },
      contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      generationConfig: {
        maxOutputTokens: Math.min(prompt.maxTokens, 65535),
        temperature: 0.75,
        responseMimeType: 'application/json'
      }
    });

    const espera = ms => new Promise(r => setTimeout(r, ms));

    // Pergunta ao Google quais modelos a chave pode usar e prioriza os "flash"
    let modelos = [];
    try {
      const lst = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(gKey)}&pageSize=100`);
      if (lst.ok) {
        const data = await lst.json();
        const nomes = (data.models || [])
          .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
          .map(m => String(m.name || '').replace(/^models\//, ''))
          .filter(n => !/embedding|imagen|veo|tts|audio|image|live|robotics|gemma|nano|exp\b/i.test(n));
        const score = n =>
          (/flash/i.test(n) && !/lite/i.test(n) ? 0 : /flash/i.test(n) ? 10 : 20)
          - (/latest/i.test(n) ? 2 : 0);
        modelos = [...new Set(nomes)].sort((a, b) => score(a) - score(b)).slice(0, 5);
      }
    } catch { /* usa a lista fixa abaixo */ }
    if (!modelos.length) modelos = ['gemini-flash-latest', 'gemini-3-flash', 'gemini-2.5-flash'];

    let ultimo = '';
    for (const modelo of modelos) {
      for (let vez = 0; vez < 2; vez++) {
        const upstream = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:streamGenerateContent?alt=sse&key=${encodeURIComponent(gKey)}`,
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: gPayload }
        );
        if (upstream.status === 404) { ultimo = `modelo ${modelo} indisponível`; break; } // próximo modelo
        if (upstream.status === 503 || upstream.status === 429) {
          ultimo = `Gemini lotado (HTTP ${upstream.status})`;
          await espera(3000);
          continue; // re-tenta o mesmo modelo; persistindo, cai pro próximo
        }
        if (!upstream.ok) {
          let detalhe = '';
          try { detalhe = (await upstream.json())?.error?.message || ''; } catch { /* sem detalhe */ }
          return erro(`Erro do Gemini (${upstream.status}): ${detalhe || 'verifique a chave em ⚙ Configurações.'}`, 502);
        }
        return new Response(upstream.body, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
          }
        });
      }
    }
    return erro(`${ultimo || 'Gemini indisponível'} — tente de novo em alguns minutos. [modelos testados: ${modelos.join(', ')}]`, 503);
  }

  /* ============ Motor CLAUDE (API da Anthropic) ============ */
  const apiKey = context.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return erro('O modo automático com Claude exige a ANTHROPIC_API_KEY no Cloudflare (Settings → Variables and Secrets). Dica: use o modo "Grátis — tudo aqui no site (Gemini)" no passo 4.', 500);
  }

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
