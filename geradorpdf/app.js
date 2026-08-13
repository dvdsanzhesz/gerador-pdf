/* ============================================================
   CESS — Gerador de Apostilas (lógica do app)
   ============================================================ */
import { renderApostilaHTML } from './apostila.js';
import { buildPrompt, buildCopyPrompt } from './prompts.js';

const RODAPE_PADRAO = 'Apostila criada por Centro Educacional Sete de Setembro | Proibida a reprodução ou distribuição';
const MODELO_PADRAO = 'claude-fable-5';
const TIPO_NOME = { insights: 'Principais Insights', tema: 'Guia Temático', manual: 'Manual do Curso' };
const TIPO_MODE = { insights: 'vol1', tema: 'vol2', manual: 'vol3' };

/* ---------------- estado ---------------- */
let projeto = {
  nomeCurso: '',
  capaImagem: null,
  aulas: [],            // {url, titulo, texto, status, usar}
  temas: [],            // sugestões [{titulo, descricao, porque}]
  volumes: [],          // [{tipo:'insights'|'tema'|'manual', tema:''}]
  apostilas: {}         // {indiceDoVolume: dadosDaApostila}
};
let config = { modelo: MODELO_PADRAO, rodape: RODAPE_PADRAO, chave: '', modo: 'gemini', gas: '', gemini: '' };
let volumeAtual = null;   // índice do volume aberto no preview
let ultimoPedido = null;  // índice do último pedido copiado no modo colar
let abortCtl = null;

/* ---------------- helpers ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function toast(msg, erro = false, ms = 5000) {
  $$('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (erro ? ' erro' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

let salvarTimer = null;
function salvar() {
  clearTimeout(salvarTimer);
  salvarTimer = setTimeout(() => {
    try { localStorage.setItem('cess_projeto_v1', JSON.stringify(projeto)); } catch { /* projeto grande demais: segue sem persistir */ }
  }, 400);
}
function salvarConfig() {
  localStorage.setItem('cess_config_v1', JSON.stringify(config));
}
function milhar(n) { return Number(n || 0).toLocaleString('pt-BR'); }

function metaVolume(i) {
  const v = projeto.volumes[i] || {};
  return {
    rotulo: `Volume ${i + 1} — ${TIPO_NOME[v.tipo] || 'Apostila'}`,
    prefixo: `Vol ${i + 1}`
  };
}

/* ---------------- aulas ---------------- */
function novaAula(dados = {}) {
  projeto.aulas.push({ url: '', titulo: '', texto: '', status: '', usar: true, ...dados });
  desenharAulas();
  salvar();
}

function sincronizarChkTodas() {
  const chk = $('#chkTodas');
  if (!chk || !projeto.aulas.length) return;
  const usadas = projeto.aulas.filter(a => a.usar !== false).length;
  chk.checked = usadas === projeto.aulas.length;
  chk.indeterminate = usadas > 0 && usadas < projeto.aulas.length;
}

function desenharAulas() {
  const lista = $('#listaAulas');
  lista.innerHTML = '';
  projeto.aulas.forEach((aula, i) => {
    const node = $('#tplAula').content.cloneNode(true);
    const root = node.querySelector('.aula');
    node.querySelector('.aula-num').textContent = i + 1;
    const inpUrl = node.querySelector('.aula-url');
    const inpTitulo = node.querySelector('.aula-titulo');
    const inpTexto = node.querySelector('.aula-texto');
    const status = node.querySelector('.aula-status');

    inpUrl.value = aula.url;
    inpTitulo.value = aula.titulo;
    inpTexto.value = aula.texto;
    const chkUsar = node.querySelector('.aula-usar');
    chkUsar.checked = aula.usar !== false;
    chkUsar.addEventListener('change', () => {
      aula.usar = chkUsar.checked;
      sincronizarChkTodas();
      salvar();
    });
    atualizarStatusAula(status, aula);

    inpUrl.addEventListener('input', () => { aula.url = inpUrl.value.trim(); salvar(); });
    inpTitulo.addEventListener('input', () => { aula.titulo = inpTitulo.value; salvar(); });
    inpTexto.addEventListener('input', () => {
      aula.texto = inpTexto.value;
      aula.status = aula.texto.trim() ? 'manual' : '';
      atualizarStatusAula(status, aula);
      salvar();
    });
    node.querySelector('.aula-arquivo').addEventListener('change', ev => {
      const file = ev.target.files[0];
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        aula.texto = limparLegenda(String(rd.result || ''), file.name);
        aula.status = aula.texto.trim() ? 'manual' : '';
        if (!aula.titulo) aula.titulo = file.name.replace(/\.(txt|srt|vtt)$/i, '');
        inpTexto.value = aula.texto;
        inpTitulo.value = aula.titulo;
        atualizarStatusAula(status, aula);
        salvar();
      };
      rd.readAsText(file);
    });
    node.querySelector('.aula-puxar').addEventListener('click', async ev => {
      const btn = ev.currentTarget;
      btn.disabled = true; btn.textContent = 'Extraindo…';
      await puxarTranscricao(aula, status, root);
      btn.disabled = false; btn.textContent = 'Puxar transcrição';
      salvar();
    });
    node.querySelector('.aula-remover').addEventListener('click', () => {
      projeto.aulas.splice(i, 1);
      if (!projeto.aulas.length) novaAula();
      desenharAulas();
      salvar();
    });
    lista.appendChild(node);
  });
  sincronizarChkTodas();
}

function atualizarStatusAula(el, aula) {
  el.className = 'aula-status';
  if (aula.status === 'ok') {
    el.classList.add('ok');
    el.textContent = `✔ Transcrição extraída${aula.titulo ? ` — “${aula.titulo}”` : ''} (${milhar(aula.texto.length)} caracteres${aula.auto ? ', legenda automática' : ''})`;
  } else if (aula.status === 'manual') {
    el.classList.add('ok');
    el.textContent = `✔ Transcrição pronta (${milhar(aula.texto.length)} caracteres)`;
  } else if (aula.status === 'erro') {
    el.classList.add('err');
    el.textContent = `✖ ${aula.erro || 'Falha na extração — cole manualmente abaixo.'}`;
  } else {
    el.textContent = 'Aguardando link ou transcrição…';
  }
}

/* ---------------- extração de transcrição ---------------- */
const ESPELHOS_NAVEGADOR = ['https://yewtu.be', 'https://id.420129.xyz', 'https://inv.nadeko.net'];

function videoIdDe(url) {
  const s = String(url || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = s.match(/[?&]v=([\w-]{11})/) || s.match(/youtu\.be\/([\w-]{11})/) || s.match(/\/(?:shorts|live|embed)\/([\w-]{11})/);
  return m ? m[1] : null;
}

function sinal(ms) {
  try { return AbortSignal.timeout(ms); } catch { return undefined; }
}

async function espelhoNavegador(videoId) {
  for (const base of ESPELHOS_NAVEGADOR) {
    try {
      const res = await fetch(`${base}/api/v1/captions/${videoId}`, { signal: sinal(7000) });
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
      const cres = await fetch(base + track.url, { signal: sinal(7000) });
      if (!cres.ok) continue;
      const texto = limparLegenda(await cres.text(), 'legenda.vtt');
      if (texto.length < 40) continue;
      let titulo = '';
      try {
        const v = await fetch(`${base}/api/v1/videos/${videoId}?fields=title`, { signal: sinal(5000) });
        if (v.ok) titulo = (await v.json()).title || '';
      } catch { /* título é opcional */ }
      return { texto, titulo, auto: /auto/i.test(track.label || '') };
    } catch { /* tenta o próximo espelho */ }
  }
  return null;
}

async function puxarTranscricaoDados(aula) {
  let erroBackend = '';
  try {
    const res = await fetch('api/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: aula.url, gas: config.gas || '', gemini: config.gemini || '' })
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error('Backend indisponível — este site precisa estar publicado no Cloudflare (veja o README).');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    aula.texto = data.text;
    aula.titulo = aula.titulo || data.title || '';
    aula.auto = data.auto;
    aula.status = 'ok';
    aula.erro = '';
    return true;
  } catch (e) {
    erroBackend = e.message;
  }

  const vid = videoIdDe(aula.url);
  if (vid) {
    const alt = await espelhoNavegador(vid);
    if (alt) {
      aula.texto = alt.texto;
      aula.titulo = aula.titulo || alt.titulo || '';
      aula.auto = alt.auto;
      aula.status = 'ok';
      aula.erro = '';
      return true;
    }
  }

  aula.status = 'erro';
  aula.erro = erroBackend;
  return false;
}

async function puxarTranscricao(aula, statusEl, rootEl) {
  if (!aula.url) { toast('Cole o link do YouTube primeiro.', true); return; }
  await puxarTranscricaoDados(aula);
  atualizarStatusAula(statusEl, aula);
  rootEl.querySelector('.aula-texto').value = aula.texto || '';
  rootEl.querySelector('.aula-titulo').value = aula.titulo || '';
  if (aula.status === 'erro') rootEl.querySelector('.aula-manual').open = true;
}

async function extrairPendentes(pendentes) {
  if (!pendentes.length) return [];
  $('#statusGeracao').classList.remove('oculto');
  $('#statusTitulo').textContent = 'Extraindo transcrições do YouTube…';
  $('#statusDetalhe').textContent = `${pendentes.length} aula(s) — vídeo sem legenda pode levar 1 a 3 min (IA transcrevendo)`;
  try {
    await Promise.all(pendentes.map(a => puxarTranscricaoDados(a)));
  } finally {
    $('#statusGeracao').classList.add('oculto');
  }
  desenharAulas();
  salvar();
  return pendentes.filter(a => a.status === 'erro');
}

async function garantirTranscricoes() {
  const pendentes = projeto.aulas.filter(a =>
    a.usar !== false && a.url && a.url.trim() && (!a.texto || a.texto.trim().length <= 50));
  const falhas = await extrairPendentes(pendentes);
  if (falhas.length) {
    toast(`Não consegui extrair a transcrição de ${falhas.length} aula(s) — ${falhas[0].erro || ''} Nessas aulas, abra “colar transcrição manualmente” (ou desmarque a caixinha delas).`, true, 11000);
    return false;
  }
  return true;
}

async function extrairTodas() {
  const pendentes = projeto.aulas.filter(a => a.url && a.url.trim() && (!a.texto || a.texto.trim().length <= 50));
  if (!pendentes.length) { toast('Todas as aulas com link já têm transcrição.'); return; }
  const falhas = await extrairPendentes(pendentes);
  const ok = pendentes.length - falhas.length;
  if (falhas.length) toast(`${ok} transcrição(ões) extraída(s); ${falhas.length} falhou(aram) — ${falhas[0].erro || ''}`, true, 10000);
  else toast(`Prontinho: ${ok} transcrição(ões) extraída(s)! Agora gere os volumes do passo 4.`);
}

function aulasProntas() {
  return projeto.aulas.filter(a => a.usar !== false && a.texto && a.texto.trim().length > 50);
}

/* Limpa arquivos .srt/.vtt */
function limparLegenda(texto, nomeArquivo = '') {
  if (!/\.(srt|vtt)$/i.test(nomeArquivo) && !/-->/.test(texto)) return texto.trim();
  const linhas = String(texto).split(/\r?\n/);
  const uteis = [];
  for (const l of linhas) {
    const t = l.trim();
    if (!t) continue;
    if (/^WEBVTT/i.test(t) || /^(Kind|Language|NOTE|STYLE)[:\s]/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (/-->/.test(t)) continue;
    const limpo = t.replace(/<[^>]+>/g, '').trim();
    if (limpo && limpo !== uteis[uteis.length - 1]) uteis.push(limpo);
  }
  return uteis.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/* ---------------- volumes (quantos quiser) ---------------- */
function novoVolume(dados = {}) {
  projeto.volumes.push({ tipo: 'tema', tema: '', ...dados });
  desenharVolumes();
  salvar();
}

function desenharVolumes() {
  const lista = $('#listaVolumes');
  lista.innerHTML = '';
  projeto.volumes.forEach((vol, i) => {
    const node = $('#tplVolume').content.cloneNode(true);
    node.querySelector('.vol-num').textContent = i + 1;
    const selTipo = node.querySelector('.vol-tipo');
    const inpTema = node.querySelector('.vol-tema');
    const status = node.querySelector('.vol-status');
    const btnVer = node.querySelector('.vol-ver');
    const btnGerar = node.querySelector('.vol-gerar');

    selTipo.value = vol.tipo;
    inpTema.value = vol.tema || '';
    inpTema.classList.toggle('oculto', vol.tipo !== 'tema');

    const atualizarStatus = () => {
      if (projeto.apostilas[i]) {
        status.textContent = `✔ gerada: ${projeto.apostilas[i].titulo || ''}`;
        status.className = 'vol-status ok';
        btnVer.classList.remove('oculto');
        btnGerar.textContent = 'Regerar';
      } else {
        status.textContent = '';
        status.className = 'vol-status';
        btnVer.classList.add('oculto');
        btnGerar.textContent = 'Gerar';
      }
    };
    atualizarStatus();

    selTipo.addEventListener('change', () => {
      vol.tipo = selTipo.value;
      inpTema.classList.toggle('oculto', vol.tipo !== 'tema');
      salvar();
    });
    inpTema.addEventListener('input', () => { vol.tema = inpTema.value; salvar(); });
    btnGerar.addEventListener('click', () => gerarVolumeIdx(i));
    btnVer.addEventListener('click', () => mostrarPreview(i));
    node.querySelector('.vol-remover').addEventListener('click', () => {
      projeto.volumes.splice(i, 1);
      const novas = {};
      Object.keys(projeto.apostilas).forEach(k => {
        const n = Number(k);
        if (n < i) novas[n] = projeto.apostilas[k];
        else if (n > i) novas[n - 1] = projeto.apostilas[k];
      });
      projeto.apostilas = novas;
      if (!projeto.volumes.length) novoVolume({ tipo: 'insights' });
      desenharVolumes();
      salvar();
    });
    lista.appendChild(node);
  });

  // opções do "colar resposta" acompanham os volumes
  const sel = $('#colarDestino');
  if (sel) {
    const atual = sel.value;
    sel.innerHTML = '<option value="auto">Detectar automaticamente</option>' +
      projeto.volumes.map((v, i) => `<option value="${i}">Volume ${i + 1} — ${TIPO_NOME[v.tipo]}</option>`).join('');
    if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
  }
}

/* ---------------- chamada à IA (backend ou direto) ---------------- */
async function chamarIA({ mode, tema, onDelta, signal }) {
  const aulas = aulasProntas().map(a => ({ titulo: a.titulo, texto: a.texto }));
  const engine = config.modo === 'gemini' ? 'gemini' : 'claude';
  const payload = {
    mode,
    courseName: projeto.nomeCurso,
    tema: tema || '',
    aulas,
    model: config.modelo,
    engine,
    gemini: config.gemini || ''
  };

  let res = null;
  try {
    res = await fetch('api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    res = null;
  }

  // Sem backend? Modo direto no navegador.
  if (!res || res.status === 404 || res.status === 405) {
    const prompt = buildPrompt({ mode, courseName: projeto.nomeCurso, tema, aulas });
    if (engine === 'gemini') {
      if (!config.gemini) throw new Error('Cole sua chave gratuita do Gemini em ⚙ Configurações (aistudio.google.com/apikey).');
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.gemini)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: prompt.system }] },
          contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
          generationConfig: { maxOutputTokens: Math.min(prompt.maxTokens, 65535), temperature: 0.75, responseMimeType: 'application/json' }
        }),
        signal
      });
    } else {
      if (!config.chave) {
        throw new Error('Backend não encontrado. Publique o site no Cloudflare (veja o README) ou informe sua chave em Configurações → Avançado.');
      }
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': config.chave,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: config.modelo || MODELO_PADRAO,
          max_tokens: prompt.maxTokens,
          stream: true,
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }]
        }),
        signal
      });
    }
  }

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    let msg = `Erro HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.error || msg;
    } catch { /* mantém msg */ }
    throw new Error(msg);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = '', texto = '', stopReason = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const linhas = buffer.split('\n');
    buffer = linhas.pop();
    for (const linha of linhas) {
      if (!linha.startsWith('data:')) continue;
      const raw = linha.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(raw); } catch { continue; }
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        texto += ev.delta.text;                       // formato Anthropic
        onDelta && onDelta(texto);
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.candidates) {                     // formato Gemini
        const t = (ev.candidates[0]?.content?.parts || []).map(p => p.text || '').join('');
        if (t) { texto += t; onDelta && onDelta(texto); }
        if (ev.candidates[0]?.finishReason === 'MAX_TOKENS') stopReason = 'max_tokens';
      } else if (ev.type === 'error' || ev.error) {
        throw new Error(ev.error?.message || 'Erro no streaming da API.');
      }
    }
  }
  if (stopReason === 'max_tokens') {
    throw new Error('A resposta atingiu o limite de tokens antes de terminar. Tente novamente.');
  }
  return { texto };
}

function extrairJSON(txt) {
  let t = String(txt || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  const i = t.indexOf('{');
  const j = t.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('A resposta não veio em JSON. Tente gerar novamente.');
  const bruto = t.slice(i, j + 1);
  try {
    return JSON.parse(bruto);
  } catch {
    try { return JSON.parse(bruto.replace(/,\s*([}\]])/g, '$1')); }
    catch { throw new Error('O JSON gerado veio com defeito. Clique de novo em Gerar.'); }
  }
}

/* ---------------- sugestão de temas ---------------- */
async function sugerirTemas() {
  if (!(await garantirTranscricoes())) return;
  if (!aulasProntas().length) { toast('Cole o link da aula (ou a transcrição) no passo 2 primeiro.', true); return; }
  if (config.modo === 'claude') { copiarPedido('temas'); return; }
  if (config.modo === 'gemini' && !config.gemini) {
    toast('Cole sua chave gratuita do Gemini em ⚙ Configurações primeiro (aistudio.google.com/apikey).', true, 8000);
    abrirConfig();
    return;
  }
  const btn = $('#btnTemas');
  btn.disabled = true; btn.textContent = 'Pensando nos temas…';
  try {
    const { texto } = await chamarIA({ mode: 'temas' });
    const data = extrairJSON(texto);
    projeto.temas = data.temas || [];
    desenharTemas();
    salvar();
    toast('Temas sugeridos! Clique em um para preencher um volume "Guia temático".');
  } catch (e) {
    toast(e.message, true, 9000);
  } finally {
    btn.disabled = false; btn.textContent = '✦ Sugerir temas com IA';
  }
}

function desenharTemas() {
  const box = $('#listaTemas');
  box.innerHTML = '';
  projeto.temas.forEach(t => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tema';
    chip.textContent = t.titulo;
    chip.title = `${t.descricao || ''}\n${t.porque || ''}`.trim();
    chip.addEventListener('click', () => {
      let alvo = projeto.volumes.findIndex(v => v.tipo === 'tema' && !String(v.tema || '').trim());
      if (alvo < 0) {
        projeto.volumes.push({ tipo: 'tema', tema: '' });
        alvo = projeto.volumes.length - 1;
      }
      projeto.volumes[alvo].tema = t.titulo;
      desenharVolumes();
      salvar();
      toast(`Tema aplicado no Volume ${alvo + 1}.`);
    });
    box.appendChild(chip);
  });
}

/* ---------------- geração dos volumes ---------------- */
async function gerarVolumeIdx(i) {
  const vol = projeto.volumes[i];
  if (!vol) return;
  if (!(await garantirTranscricoes())) return;
  if (!aulasProntas().length) { toast('Cole o link da aula (ou a transcrição) no passo 2 primeiro.', true); return; }
  if (vol.tipo === 'tema' && !String(vol.tema || '').trim()) {
    toast(`Defina o tema do Volume ${i + 1} (clique numa sugestão do passo 3 ou digite no campo).`, true, 7000);
    return;
  }
  if (config.modo === 'claude') { copiarPedido(i); return; }
  if (config.modo === 'gemini' && !config.gemini) {
    toast('Cole sua chave gratuita do Gemini em ⚙ Configurações primeiro (aistudio.google.com/apikey).', true, 8000);
    abrirConfig();
    return;
  }

  abortCtl = new AbortController();
  const meta = metaVolume(i);
  $$('.vol-gerar').forEach(b => b.disabled = true);
  $('#statusGeracao').classList.remove('oculto');
  $('#statusTitulo').textContent = `Gerando ${meta.rotulo}…`;
  $('#statusDetalhe').textContent = 'Enviando as aulas para a IA…';

  try {
    const { texto } = await chamarIA({
      mode: TIPO_MODE[vol.tipo],
      tema: vol.tema,
      signal: abortCtl.signal,
      onDelta: t => {
        $('#statusDetalhe').textContent = `${milhar(t.length)} caracteres gerados · ~${Math.max(1, Math.round(t.length / 2400))} páginas`;
      }
    });
    const dados = extrairJSON(texto);
    if (!dados.paginas || !dados.paginas.length) throw new Error('A apostila veio sem páginas. Gere novamente.');
    projeto.apostilas[i] = dados;
    salvar();
    desenharVolumes();
    mostrarPreview(i);
    toast(`${meta.rotulo} pronta! Revise o preview e clique em “Salvar PDF”.`);
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, true, 10000);
  } finally {
    $('#statusGeracao').classList.add('oculto');
    $$('.vol-gerar').forEach(b => b.disabled = false);
    abortCtl = null;
  }
}

/* ---------------- modo copiar/colar no app do Claude ---------------- */
async function copiarPedido(destino) {
  const aulas = aulasProntas().map(a => ({ titulo: a.titulo, texto: a.texto }));
  const ehTemas = destino === 'temas';
  const vol = ehTemas ? null : projeto.volumes[destino];
  const texto = buildCopyPrompt({
    mode: ehTemas ? 'temas' : TIPO_MODE[vol.tipo],
    courseName: projeto.nomeCurso,
    tema: vol ? vol.tema : '',
    aulas
  });
  ultimoPedido = destino;
  if (!ehTemas) $('#colarDestino').value = 'auto';

  const nome = ehTemas ? 'sugestão de temas' : metaVolume(destino).rotulo;
  try {
    await navigator.clipboard.writeText(texto);
    toast(`Pedido de ${nome} copiado! Cole numa conversa com o Claude (app ou claude.ai) e envie. Quando ele responder, copie a resposta e cole no quadro "Modo grátis" aqui embaixo.`, false, 12000);
  } catch {
    $('#txtCopiar').value = texto;
    $('#modalCopiar').showModal();
  }
  $('#painelColar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function montarColado() {
  const bruto = $('#colarJson').value.trim();
  if (!bruto) { toast('Cole a resposta do Claude no quadro primeiro.', true); return; }
  let dados;
  try { dados = extrairJSON(bruto); }
  catch (e) { toast(e.message, true, 8000); return; }

  if (dados.temas) {
    projeto.temas = dados.temas;
    desenharTemas();
    salvar();
    $('#colarJson').value = '';
    toast('Temas montados! Clique em um para preencher um volume "Guia temático".');
    return;
  }

  if (!dados.paginas || !dados.paginas.length) {
    toast('Essa resposta não tem páginas de apostila. Confira se você copiou a resposta inteira.', true, 8000);
    return;
  }
  let destino = $('#colarDestino').value;
  if (destino === 'auto') destino = (ultimoPedido != null && ultimoPedido !== 'temas') ? ultimoPedido : 0;
  destino = Number(destino);
  if (!projeto.volumes[destino]) destino = 0;
  projeto.apostilas[destino] = dados;
  salvar();
  desenharVolumes();
  $('#colarJson').value = '';
  mostrarPreview(destino);
  toast(`${metaVolume(destino).rotulo} montada! Revise o preview e clique em “Salvar PDF”.`);
}

function atualizarModoUI() {
  const modo = config.modo;
  $('#painelColar').classList.toggle('oculto', modo !== 'claude');
  const dica = $('#dicaModo');
  if (modo === 'gemini') {
    dica.innerHTML = 'Tudo acontece <strong>aqui no site</strong>, de graça, com a sua chave do Gemini (⚙ Configurações). Clique em Gerar e aguarde: a apostila aparece no preview pronta pra salvar em PDF.';
  } else if (modo === 'claude') {
    dica.innerHTML = 'O botão Gerar <strong>copia um pedido pronto</strong>. Cole numa conversa com o Claude e traga a resposta de volta no quadro abaixo.';
  } else {
    dica.innerHTML = 'Usa a API da Anthropic (paga por uso) com a <code>ANTHROPIC_API_KEY</code> configurada no Cloudflare.';
  }
}

/* ---------------- preview / PDF ---------------- */
function mostrarPreview(i) {
  const dados = projeto.apostilas[i];
  if (!dados) return;
  volumeAtual = i;
  const meta = metaVolume(i);
  const html = renderApostilaHTML(dados, {
    rodape: config.rodape || RODAPE_PADRAO,
    capaImagem: projeto.capaImagem,
    baseHref: new URL('.', location.href).href
  });
  const frame = $('#previewFrame');
  frame.classList.remove('oculto');
  $('#previewVazio').classList.add('oculto');
  frame.srcdoc = html;
  frame.onload = () => {
    marcarOverflow(frame);
    const doc = frame.contentDocument;
    doc.title = `${meta.prefixo}_ ${String(dados.titulo || 'Apostila').replace(/[\\/:*?"<>|]/g, '')}`;
  };
  $('#previewTitulo').textContent = `${meta.rotulo}: ${dados.titulo || ''}`;
  $('#btnPDF').classList.remove('oculto');
  $('#btnEditar').classList.remove('oculto');
  $('#btnEditar').dataset.on = '';
  $('#btnEditar').textContent = '✎ Editar texto';
}

function marcarOverflow(frame) {
  try {
    const doc = frame.contentDocument;
    doc.querySelectorAll('.aviso-overflow').forEach(e => e.remove());
    doc.querySelectorAll('.sheet').forEach((sheet, i) => {
      if (i === 0) return;
      if (sheet.scrollHeight > sheet.clientHeight + 8) {
        const badge = doc.createElement('div');
        badge.className = 'aviso-overflow';
        badge.textContent = 'conteúdo passando da página — edite o texto ou gere de novo';
        sheet.appendChild(badge);
      }
    });
  } catch { /* sem acesso — ignora */ }
}

function salvarPDF() {
  const frame = $('#previewFrame');
  if (!frame || frame.classList.contains('oculto')) return;
  const win = frame.contentWindow;
  const rodar = () => { win.focus(); win.print(); };
  toast('Na janela de impressão: destino “Salvar como PDF”, margens “Nenhuma”, e ative “Gráficos de fundo”.', false, 9000);
  if (win.document.fonts && win.document.fonts.ready) {
    win.document.fonts.ready.then(rodar);
  } else {
    rodar();
  }
}

function alternarEdicao() {
  const frame = $('#previewFrame');
  const btn = $('#btnEditar');
  const doc = frame.contentDocument;
  if (!doc) return;
  const ligado = btn.dataset.on === '1';
  doc.designMode = ligado ? 'off' : 'on';
  btn.dataset.on = ligado ? '' : '1';
  btn.textContent = ligado ? '✎ Editar texto' : '✔ Concluir edição';
  if (!ligado) toast('Modo edição ativo: clique no texto da apostila e ajuste o que quiser. Depois salve o PDF.');
}

/* ---------------- configurações ---------------- */
function abrirConfig() {
  $('#cfgModelo').value = config.modelo;
  $('#cfgRodape').value = config.rodape;
  $('#cfgChave').value = config.chave;
  $('#cfgGas').value = config.gas || '';
  $('#cfgGemini').value = config.gemini || '';
  $('#modalConfig').showModal();
}

/* ---------------- boot ---------------- */
function boot() {
  try { Object.assign(config, JSON.parse(localStorage.getItem('cess_config_v1') || '{}')); } catch { /* config nova */ }
  if (!config.rodape) config.rodape = RODAPE_PADRAO;
  if (!config.modo) config.modo = 'gemini';
  try {
    const p = JSON.parse(localStorage.getItem('cess_projeto_v1') || 'null');
    if (p) projeto = Object.assign(projeto, p);
  } catch { /* projeto novo */ }
  projeto.aulas.forEach(a => { if (a.usar === undefined) a.usar = true; });

  // migração do formato antigo (vol1/vol2/vol3 fixos) para volumes dinâmicos
  if (!Array.isArray(projeto.volumes) || !projeto.volumes.length) {
    projeto.volumes = [
      { tipo: 'insights', tema: '' },
      { tipo: 'tema', tema: projeto.tema || '' },
      { tipo: 'manual', tema: '' }
    ];
    const antigas = projeto.apostilas || {};
    const novas = {};
    if (antigas.vol1) novas[0] = antigas.vol1;
    if (antigas.vol2) novas[1] = antigas.vol2;
    if (antigas.vol3) novas[2] = antigas.vol3;
    if (Object.keys(novas).length) projeto.apostilas = novas;
  }
  if (!projeto.apostilas || Array.isArray(projeto.apostilas)) projeto.apostilas = {};

  $('#nomeCurso').value = projeto.nomeCurso;
  if (!projeto.aulas.length) projeto.aulas.push({ url: '', titulo: '', texto: '', status: '', usar: true });
  desenharAulas();
  desenharVolumes();
  desenharTemas();
  if (projeto.capaImagem) mostrarCapaMini();

  $('#modoGeracao').value = config.modo;
  atualizarModoUI();
  $('#modoGeracao').addEventListener('change', e => {
    config.modo = e.target.value;
    salvarConfig();
    atualizarModoUI();
  });
  $('#btnMontar').addEventListener('click', montarColado);
  $('#btnCopiarTudo').addEventListener('click', async () => {
    const t = $('#txtCopiar');
    t.focus(); t.select();
    try { await navigator.clipboard.writeText(t.value); }
    catch { document.execCommand('copy'); }
    toast('Pedido copiado! Agora cole numa conversa com o Claude e envie.');
  });

  $('#nomeCurso').addEventListener('input', e => { projeto.nomeCurso = e.target.value; salvar(); });
  $('#btnAddAula').addEventListener('click', () => novaAula());
  $('#btnExtrairTodas').addEventListener('click', extrairTodas);
  $('#chkTodas').addEventListener('change', e => {
    projeto.aulas.forEach(a => { a.usar = e.target.checked; });
    desenharAulas();
    salvar();
  });
  $('#btnAddVolume').addEventListener('click', () => novoVolume());
  $('#btnTemas').addEventListener('click', sugerirTemas);
  $('#btnCancelar').addEventListener('click', () => abortCtl && abortCtl.abort());
  $('#btnPDF').addEventListener('click', salvarPDF);
  $('#btnEditar').addEventListener('click', alternarEdicao);
  $('#btnConfig').addEventListener('click', abrirConfig);
  $('#btnLimpar').addEventListener('click', () => {
    if (confirm('Começar um projeto novo? As aulas e apostilas geradas neste navegador serão apagadas.')) {
      localStorage.removeItem('cess_projeto_v1');
      location.reload();
    }
  });

  $('#btnSalvarConfig').addEventListener('click', () => {
    config.modelo = $('#cfgModelo').value;
    config.rodape = $('#cfgRodape').value.trim() || RODAPE_PADRAO;
    config.chave = $('#cfgChave').value.trim();
    config.gas = $('#cfgGas').value.trim();
    config.gemini = $('#cfgGemini').value.trim();
    salvarConfig();
    toast('Configurações salvas.');
  });

  $('#fotoCapa').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      projeto.capaImagem = rd.result;
      mostrarCapaMini();
      salvar();
      if (volumeAtual != null) mostrarPreview(volumeAtual);
    };
    rd.readAsDataURL(file);
  });
  $('#removerCapa').addEventListener('click', () => {
    projeto.capaImagem = null;
    $('#capaPreview').classList.add('oculto');
    $('#fotoCapa').value = '';
    salvar();
    if (volumeAtual != null) mostrarPreview(volumeAtual);
  });

  const ultimo = Object.keys(projeto.apostilas).map(Number).sort((a, b) => b - a)[0];
  if (ultimo != null && projeto.apostilas[ultimo]) mostrarPreview(ultimo);
}

function mostrarCapaMini() {
  const box = $('#capaPreview');
  box.classList.remove('oculto');
  box.querySelector('img').src = projeto.capaImagem;
}

boot();
