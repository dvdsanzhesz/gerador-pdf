/**
 * POST /api/gamma
 * Ponte para a API do Gamma (evita bloqueio de CORS no navegador e protege a chave).
 *
 * Body:
 *   { acao: "criar",  key?, payload: {...} }   → cria a geração  → { ok, generationId }
 *   { acao: "status", key?, id: "gen_..." }    → consulta status → { ok, status, gammaUrl, exportUrl, credits }
 *
 * A chave pode vir do corpo (⚙ Configurações do site) ou da variável GAMMA_API_KEY no Cloudflare.
 */

const BASE = 'https://public-api.gamma.app/v1.0/generations';

export async function onRequestPost(context) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }, 400); }

  const key = String(body.key || context.env.GAMMA_API_KEY || '').trim();
  if (!key) {
    return json({ ok: false, error: 'Chave da API do Gamma não configurada. Pegue em gamma.app → Settings → API keys e cole em ⚙ Configurações do site.' }, 400);
  }

  const cabecalhos = { 'X-API-KEY': key, 'Content-Type': 'application/json', 'Accept': 'application/json' };

  try {
    /* ---------- criar geração ---------- */
    if (body.acao === 'criar') {
      const res = await fetch(BASE, {
        method: 'POST',
        headers: cabecalhos,
        body: JSON.stringify(body.payload || {})
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || `HTTP ${res.status}`;
        const dica = res.status === 402 ? ' (créditos do Gamma esgotados)' :
                     res.status === 401 || res.status === 403 ? ' (chave inválida ou plano sem acesso à API)' : '';
        return json({ ok: false, error: `Gamma: ${msg}${dica}` }, 502);
      }
      return json({ ok: true, generationId: data.generationId, warnings: data.warnings || null });
    }

    /* ---------- consultar status ---------- */
    if (body.acao === 'status') {
      const id = String(body.id || '').trim();
      if (!id) return json({ ok: false, error: 'id da geração ausente' }, 400);
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, { headers: cabecalhos });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.message || data?.error || `HTTP ${res.status}`;
        return json({ ok: false, error: `Gamma: ${msg}` }, 502);
      }
      return json({
        ok: true,
        status: data.status,
        gammaUrl: data.gammaUrl || null,
        exportUrl: data.exportUrl || null,
        credits: data.credits || null,
        erroGamma: data.error || null
      });
    }

    return json({ ok: false, error: 'ação inválida (use "criar" ou "status")' }, 400);
  } catch (e) {
    return json({ ok: false, error: `Falha ao falar com o Gamma: ${e.message || e}` }, 502);
  }
}
