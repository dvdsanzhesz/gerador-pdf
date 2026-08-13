/**
 * POST /api/transcript  { url: "https://www.youtube.com/watch?v=..." }
 * Extrai a transcrição (legendas) de um vídeo do YouTube.
 *
 * Ordem de tentativas:
 *  1. YouTube direto (clientes ANDROID e WEB do InnerTube + página do vídeo)
 *  2. Espelhos públicos do Invidious (contornam bloqueios 429 do YouTube)
 *  3. Espelhos públicos do Piped
 * Se nada funcionar, o front-end oferece o modo manual (colar a transcrição).
 */

const UA_ANDROID = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const UA_WEB = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const INVIDIOUS = [
  'https://yewtu.be',
  'https://id.420129.xyz',
  'https://inv.nadeko.net'
];
const PIPED = [
  'https://api.piped.private.coffee'
];

/* Busca a lista atual de espelhos no registro oficial (se falhar, usa a lista fixa) */
async function listaInvidious() {
  try {
    const res = await fetch('https://api.invidious.io/instances.json?sort_by=health', {
      headers: { 'Accept': 'application/json' }, signal: tmSignal(5000)
    });
    if (!res.ok) throw new Error('registro indisponível');
    const data = await res.json();
    const urls = data
      .filter(e => e[1] && e[1].type === 'https' && e[1].api !== false)
      .map(e => String(e[1].uri || '').replace(/\/+$/, ''))
      .filter(Boolean)
      .slice(0, 8);
    const todas = [...new Set([...urls, ...INVIDIOUS])];
    return todas.length ? todas : INVIDIOUS;
  } catch {
    return INVIDIOUS;
  }
}

function videoIdFrom(url) {
  const s = String(url || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m =
    s.match(/[?&]v=([\w-]{11})/) ||
    s.match(/youtu\.be\/([\w-]{11})/) ||
    s.match(/\/(?:shorts|live|embed)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function tmSignal(ms) {
  try { return AbortSignal.timeout(ms); } catch { return undefined; }
}

/* ---------------- tentativa 1: YouTube direto ---------------- */

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
    body: JSON.stringify({ context: c.context, videoId }),
    signal: tmSignal(8000)
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
    },
    signal: tmSignal(8000)
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
  const res = await fetch(url, { headers: { 'User-Agent': UA_WEB }, signal: tmSignal(8000) });
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

/* ---------------- limpeza de legendas (VTT / XML) ---------------- */

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ');
}

function parseCaptionText(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  let linhas;
  if (t.startsWith('<')) {
    const matches = [...t.matchAll(/<(?:text|p)\b[^>]*>([\s\S]*?)<\/(?:text|p)>/g)].map(m => m[1]);
    linhas = matches.map(x => x.replace(/<[^>]+>/g, ' '));
  } else {
    linhas = t.split(/\r?\n/);
  }
  const uteis = [];
  for (const l of linhas) {
    const s = l.replace(/<[^>]+>/g, '').trim();
    if (!s) continue;
    if (/^WEBVTT/i.test(s) || /^(Kind|Language|NOTE|STYLE)[:\s]/i.test(s)) continue;
    if (/^\d+$/.test(s)) continue;
    if (/-->/.test(s)) continue;
    const limpo = decodeEntities(s).trim();
    if (limpo && limpo !== uteis[uteis.length - 1]) uteis.push(limpo);
  }
  return uteis.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/* ---------------- tentativa 2: espelhos Invidious ---------------- */

async function tryInvidious(videoId) {
  const bases = await listaInvidious();
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/api/v1/captions/${videoId}`, {
        headers: { 'Accept': 'application/json' }, signal: tmSignal(6000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const caps = data.captions || [];
      if (!caps.length) continue;
      const score = c => {
        const lang = (c.language_code || c.languageCode || '').toLowerCase();
        const auto = /auto/i.test(c.label || '');
        if (lang.startsWith('pt') && !auto) return 0;
        if (lang.startsWith('pt')) return 1;
        if (!auto) return 2;
        return 3;
      };
      const track = [...caps].sort((a, b) => score(a) - score(b))[0];
      const cres = await fetch(base + track.url, { signal: tmSignal(6000) });
      if (!cres.ok) continue;
      const text = parseCaptionText(await cres.text());
      if (text.length < 40) continue;
      let title = '', dur = 0;
      try {
        const vres = await fetch(`${base}/api/v1/videos/${videoId}?fields=title,lengthSeconds`, { signal: tmSignal(5000) });
        if (vres.ok) { const v = await vres.json(); title = v.title || ''; dur = Number(v.lengthSeconds || 0); }
      } catch { /* título é opcional */ }
      return {
        text, title, durationSeconds: dur,
        language: track.language_code || track.languageCode || '',
        auto: /auto/i.test(track.label || '')
      };
    } catch { /* tenta o próximo espelho */ }
  }
  return null;
}

/* ---------------- tentativa 3: espelhos Piped ---------------- */

async function tryPiped(videoId) {
  for (const base of PIPED) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { 'Accept': 'application/json' }, signal: tmSignal(6000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      const subs = data.subtitles || [];
      if (!subs.length) continue;
      const score = s => {
        const lang = (s.code || '').toLowerCase();
        if (lang.startsWith('pt') && !s.autoGenerated) return 0;
        if (lang.startsWith('pt')) return 1;
        if (!s.autoGenerated) return 2;
        return 3;
      };
      const track = [...subs].sort((a, b) => score(a) - score(b))[0];
      const cres = await fetch(track.url, { signal: tmSignal(6000) });
      if (!cres.ok) continue;
      const text = parseCaptionText(await cres.text());
      if (text.length < 40) continue;
      return {
        text, title: data.title || '', durationSeconds: Number(data.duration || 0),
        language: track.code || '', auto: !!track.autoGenerated
      };
    } catch { /* tenta o próximo espelho */ }
  }
  return null;
}

/* ---------------- tentativa final: Gemini transcreve o áudio (vídeo SEM legenda) ---------------- */

async function tryGemini(videoId, key) {
  const modelos = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-flash-latest'];
  const espera = ms => new Promise(r => setTimeout(r, ms));
  let erro = 'nenhum modelo Gemini disponível';

  for (const modelo of modelos) {
    // até 2 tentativas por modelo (com pausa quando estiver sobrecarregado)
    for (let vez = 0; vez < 2; vez++) {
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { fileData: { fileUri: `https://www.youtube.com/watch?v=${videoId}` } },
                { text: 'Transcreva integralmente a fala deste vídeo, em português, como texto corrido. Sem timestamps, sem títulos, sem comentários seus — apenas a transcrição completa.' }
              ]
            }],
            generationConfig: { temperature: 0 }
          }),
          signal: tmSignal(240000)
        });
      } catch (e) {
        erro = `falha de rede no Gemini (${e.message || e})`;
        break; // tenta o próximo modelo
      }

      if (res.status === 404) { erro = `modelo ${modelo} indisponível`; break; } // próximo modelo
      if (res.status === 503 || res.status === 429) {
        erro = `Gemini lotado no momento (HTTP ${res.status}) — tente de novo em alguns minutos`;
        await espera(3000);
        continue; // re-tenta o mesmo modelo; se persistir, cai para o próximo
      }
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.json())?.error?.message || ''; } catch { /* sem detalhe */ }
        throw new Error(`Gemini HTTP ${res.status}${msg ? ' — ' + msg.slice(0, 160) : ''}`);
      }

      const data = await res.json();
      const text = (data?.candidates?.[0]?.content?.parts || [])
        .map(p => p.text || '').join(' ').replace(/\s{2,}/g, ' ').trim();
      if (text.length < 40) { erro = `a transcrição do ${modelo} veio vazia`; break; }
      return { text, title: '', durationSeconds: 0, language: 'pt', auto: true };
    }
  }
  throw new Error(erro);
}

/* ---------------- rota ---------------- */

export async function onRequestPost(context) {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

  let body;
  try { body = await context.request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }); }

  const videoId = videoIdFrom(body.url);
  if (!videoId) return json({ ok: false, error: 'Não reconheci esse link do YouTube. Confira a URL.' });

  const respostaOk = (r, fonte) => json({
    ok: true, videoId, fonte,
    title: r.title || '', durationSeconds: r.durationSeconds || 0,
    language: r.language || '', auto: !!r.auto,
    chars: r.text.length, text: r.text
  });

  // 0) Extrator próprio no Google (Apps Script) — o caminho mais confiável, se configurado
  const gas = String(body.gas || context.env.GAS_URL || '').trim();
  if (gas && /^https:\/\/script\.google(?:usercontent)?\.com\//.test(gas)) {
    try {
      const sep = gas.includes('?') ? '&' : '?';
      const res = await fetch(`${gas}${sep}video=${videoId}`, {
        redirect: 'follow',
        signal: tmSignal(25000)
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.ok && data.text && data.text.length > 40) {
          return respostaOk({
            text: data.text, title: data.title || '',
            durationSeconds: Number(data.durationSeconds || 0),
            language: data.language || '', auto: !!data.auto
          }, 'google');
        }
      }
    } catch { /* segue para os outros planos */ }
  }

  // 1) YouTube direto (com uma re-tentativa após pausa — o bloqueio 429 às vezes é passageiro)
  const espera = ms => new Promise(r => setTimeout(r, ms));
  const tentativas = [
    () => playerResponse(videoId, 'ANDROID'),
    () => playerResponse(videoId, 'WEB'),
    () => watchPageResponse(videoId),
    async () => { await espera(1500); return playerResponse(videoId, 'ANDROID'); }
  ];
  let ultimoErro = 'sem legendas';
  for (const tenta of tentativas) {
    try {
      const pr = await tenta();
      const status = pr?.playabilityStatus?.status;
      if (status && status !== 'OK' && !pr?.captions) { ultimoErro = `vídeo indisponível (${status})`; continue; }
      const track = pickTrack(pr);
      if (!track) { ultimoErro = 'o vídeo não tem legendas/transcrição disponíveis'; continue; }
      const text = await fetchTrackText(track);
      if (!text || text.length < 40) { ultimoErro = 'transcrição vazia'; continue; }
      const vd = pr.videoDetails || {};
      return respostaOk({
        text, title: vd.title || '', durationSeconds: Number(vd.lengthSeconds || 0),
        language: track.languageCode || '', auto: track.kind === 'asr'
      }, 'youtube');
    } catch (e) {
      ultimoErro = e.message || String(e);
    }
  }

  // 2) e 3) Espelhos públicos (contornam o bloqueio do YouTube a servidores de nuvem)
  const alt = (await tryInvidious(videoId)) || (await tryPiped(videoId));
  if (alt) return respostaOk(alt, 'espelho');

  // 4) Gemini transcreve o áudio (funciona até para vídeo SEM legenda — igual ao NotebookLM)
  const geminiKey = String(body.gemini || context.env.GEMINI_API_KEY || '').trim();
  if (geminiKey) {
    try {
      const g = await tryGemini(videoId, geminiKey);
      return respostaOk(g, 'gemini');
    } catch (e) {
      ultimoErro = `Gemini: ${e.message || e}`;
    }
  }

  const dicaGemini = geminiKey
    ? ''
    : ' Dica: configure a chave gratuita do Gemini em ⚙ Configurações — aí a transcrição sai até de vídeo sem legenda, igual ao NotebookLM.';
  return json({
    ok: false,
    error: `Não consegui extrair a transcrição (${ultimoErro}).${dicaGemini} Alternativa que sempre funciona: "colar transcrição manualmente".`
  });
}
