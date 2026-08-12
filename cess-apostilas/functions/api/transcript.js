/**
 * POST /api/transcript  { url: "https://www.youtube.com/watch?v=..." }
 * Extrai a transcrição (legendas) de um vídeo do YouTube.
 * Tenta o cliente ANDROID do InnerTube, depois o cliente WEB e, por fim,
 * a própria página do vídeo. Se nada funcionar, o front-end oferece
 * o modo manual (colar a transcrição).
 */

const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function videoIdFrom(url) {
  const s = String(url || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m =
    s.match(/[?&]v=([\w-]{11})/) ||
    s.match(/youtu\.be\/([\w-]{11})/) ||
    s.match(/\/(?:shorts|live|embed)\/([\w-]{11})/);
  return m ? m[1] : null;
}

async function playerResponse(videoId, clientName) {
  const clients = {
    ANDROID: {
      ua: UA_ANDROID,
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'pt', gl: 'BR' } }
    },
    WEB: {
      ua: UA_WEB,
      context: { client: { clientName: 'WEB', clientVersion: '2.20240726.00.00', hl: 'pt', gl: 'BR' } }
    }
  };
  const c = clients[clientName];
  const res = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    body: JSON.stringify({ context: c.context, videoId })
  });
  if (!res.ok) throw new Error(`player ${clientName} HTTP ${res.status}`);
  return res.json();
}

async function watchPageResponse(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=pt`, {
    headers: {
      'User-Agent': UA_WEB,
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'Cookie': 'CONSENT=YES+cb; SOCS=CAI'
    }
  });
  if (!res.ok) throw new Error(`watch HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script>)/s);
  if (!m) throw new Error('ytInitialPlayerResponse não encontrado');
  return JSON.parse(m[1]);
}

function pickTrack(pr) {
  const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;
  const score = t => {
    const lang = (t.languageCode || '').toLowerCase();
    const auto = t.kind === 'asr';
    if (lang.startsWith('pt') && !auto) return 0;
    if (lang.startsWith('pt') && auto) return 1;
    if (!auto) return 2;
    return 3;
  };
  return [...tracks].sort((a, b) => score(a) - score(b))[0];
}

async function fetchTrackText(track) {
  const sep = track.baseUrl.includes('?') ? '&' : '?';
  const url = `${track.baseUrl}${sep}fmt=json3`;
  const res = await fetch(url, { headers: { 'User-Agent': UA_WEB } });
  if (!res.ok) throw new Error(`timedtext HTTP ${res.status}`);
  const data = await res.json();
  const parts = [];
  for (const ev of data.events || []) {
    if (!ev.segs) continue;
    const line = ev.segs.map(s => s.utf8 || '').join('');
    if (line.trim()) parts.push(line.replace(/\n/g, ' ').trim());
  }
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}

export async function onRequestPost(context) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }); }

  const videoId = videoIdFrom(body.url);
  if (!videoId) return json({ ok: false, error: 'Não reconheci esse link do YouTube. Confira a URL.' });

  const tentativas = [
    () => playerResponse(videoId, 'ANDROID'),
    () => playerResponse(videoId, 'WEB'),
    () => watchPageResponse(videoId)
  ];

  let ultimoErro = 'sem legendas';
  for (const tenta of tentativas) {
    try {
      const pr = await tenta();
      const status = pr?.playabilityStatus?.status;
      if (status && status !== 'OK' && !pr?.captions) {
        ultimoErro = `vídeo indisponível (${status})`;
        continue;
      }
      const track = pickTrack(pr);
      if (!track) { ultimoErro = 'o vídeo não tem legendas/transcrição disponíveis'; continue; }
      const text = await fetchTrackText(track);
      if (!text || text.length < 40) { ultimoErro = 'transcrição vazia'; continue; }
      const vd = pr.videoDetails || {};
      return json({
        ok: true,
        videoId,
        title: vd.title || '',
        durationSeconds: Number(vd.lengthSeconds || 0),
        language: track.languageCode || '',
        auto: track.kind === 'asr',
        chars: text.length,
        text
      });
    } catch (e) {
      ultimoErro = e.message || String(e);
    }
  }

  return json({
    ok: false,
    error: `Não consegui extrair a transcrição automaticamente (${ultimoErro}). Use a opção "colar transcrição manualmente".`
  });
}
