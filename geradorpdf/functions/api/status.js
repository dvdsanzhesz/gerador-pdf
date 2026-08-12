/**
 * GET /api/status — teste rápido do backend (formato Cloudflare Pages).
 * Se responder {"ok":true}, o motor está ligado.
 */
export async function onRequestGet() {
  return new Response(JSON.stringify({ ok: true, motor: 'ligado', formato: 'pages' }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
