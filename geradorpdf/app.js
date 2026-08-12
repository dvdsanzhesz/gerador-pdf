/* ============================================================
   CESS — Gerador de Apostilas (lógica do app)
   ============================================================ */
import { renderApostilaHTML } from './apostila.js';
import { buildPrompt, buildCopyPrompt } from './prompts.js';

const RODAPE_PADRAO = 'Apostila criada por Centro Educacional Sete de Setembro | Proibida a reprodução ou distribuição';
const MODELO_PADRAO = 'claude-fable-5';
const VOL_META = {
  vol1: { rotulo: 'Volume 1 — Principais Insights', prefixo: 'Vol 1' },
  vol2: { rotulo: 'Volume 2 — Guia Temático', prefixo: 'Vol 2' },
  vol3: { rotulo: 'Volume 3 — Manual do Curso', prefixo: 'Vol 3' }
};

/* ---------------- estado ---------------- */
let projeto = {
  nomeCurso: '',
  capaImagem: null,
  aulas: [],            // {url, titulo, texto, status}
  temas: [],            // sugestões [{titulo, descricao, porque}]
  tema: '',
  apostilas: {}         // {vol1: dados, vol2: dados, vol3: dados}
};
let config = { modelo: MODELO_PADRAO, rodape: RODAPE_PADRAO, chave: '', modo: 'claude' };
let volumeAtual = null;
let abortCtl = null;
let ultimoPedido = null; // último volume copiado no modo grátis

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
    try { localStorage.setItem('cess_projeto_v1', JSON.stringify(projeto)); } catch { /* projeto grande demais para o localStorage: segue sem persistir */ }
  }, 400);
}
function salvarConfig() {
  localStorage.setItem('cess_config_v1', JSON.stringify(config));
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
    el.textContent = `✔ Transcrição colada manualmente (${milhar(aula.texto.length)} caracteres)`;
  } else if (aula.status === 'erro') {
    el.classList.add('err');
    el.textContent = `✖ ${aula.erro || 'Falha na extração — cole manualmente abaixo.'}`;
  } else {
    el.textContent = 'Aguardando link ou transcrição…';
  }
}

async function puxarTranscricaoDados(aula) {
  try {
    const res = await fetch('api/transcript', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: aula.url })
    });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('json')) throw new Error('Backend indisponível — este site precisa estar publicado no Cloudflare (veja o README), ou cole a transcrição manualmente.');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    aula.texto = data.text;
    aula.titulo = aula.titulo || data.title || '';
    aula.auto = data.auto;
    aula.status = 'ok';
    aula.erro = '';
    return true;
  } catch (e) {
    aula.status = 'erro';
    aula.erro = e.message;
    return false;
  }
}

async function puxarTranscricao(aula, statusEl, rootEl) {
  if (!aula.url) { toast('Cole o link do YouTube primeiro.', true); return; }
  await puxarTranscricaoDados(aula);
  atualizarStatusAula(statusEl, aula);
  rootEl.querySelector('.aula-texto').value = aula.texto || '';
  rootEl.querySelector('.aula-titulo').value = aula.titulo || '';
  if (aula.status === 'erro') rootEl.querySelector('.aula-manual').open = true;
}

/* Extrai a transcrição de um conjunto de aulas, com painel de progresso */
async function extrairPendentes(pendentes) {
  if (!pendentes.length) return [];
  $('#statusGeracao').classList.remove('oculto');
  $('#statusTitulo').textContent = 'Extraindo transcrições do YouTube…';
  $('#statusDetalhe').textContent = `${pendentes.length} aula(s) — isso leva alguns segundos`;
  try {
    await Promise.all(pendentes.map(a => puxarTranscricaoDados(a)));
  } finally {
    $('#statusGeracao').classList.add('oculto');
  }
  desenharAulas();
  salvar();
  return pendentes.filter(a => a.status === 'erro');
}

/* Antes de gerar: puxa sozinho a transcrição das aulas MARCADAS que só têm o link */
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

/* Botão "Extrair todas": puxa a transcrição de TODAS as aulas com link */
async function extrairTodas() {
  const pendentes = projeto.aulas.filter(a => a.url && a.url.trim() && (!a.texto || a.texto.trim().length <= 50));
  if (!pendentes.length) { toast('Todas as aulas com link já têm transcrição.'); return; }
  const falhas = await extrairPendentes(pendentes);
  const ok = pendentes.length - falhas.length;
  if (falhas.length) toast(`${ok} transcrição(ões) extraída(s); ${falhas.length} falhou(aram) — ${falhas[0].erro || ''}`, true, 10000);
  else toast(`Prontinho: ${ok} transcrição(ões) extraída(s)! Marque as aulas que entram na apostila e gere o volume.`);
}

function aulasProntas() {
  return projeto.aulas.filter(a => a.usar !== false && a.texto && a.texto.trim().length > 50);
}

/* Limpa arquivos .srt/.vtt: remove numeração, timestamps e tags, e junta o texto */
function limparLegenda(texto, nomeArquivo = '') {
  if (!/\.(srt|vtt)$/i.test(nomeArquivo) && !/-->/.test(texto)) return texto.trim();
  const linhas = String(texto).split(/\r?\n/);
  const uteis = [];
  for (const l of linhas) {
    const t = l.trim();
    if (!t) continue;
    if (/^WEBVTT/i.test(t) || /^(Kind|Language|NOTE|STYLE)[:\s]/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue;                    // número de sequência
    if (/-->/.test(t)) continue;                      // linha de tempo
    const limpo = t.replace(/<[^>]+>/g, '').trim();   // tags <c>, <i> etc.
    if (limpo && limpo !== uteis[uteis.length - 1]) uteis.push(limpo);
  }
  return uteis.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function milhar(n) { return Number(n || 0).toLocaleString('pt-BR'); }

/* ---------------- chamada ao Claude (backend ou direto) ---------------- */
async function chamarClaude({ mode, onDelta, signal }) {
  const aulas = aulasProntas().map(a => ({ titulo: a.titulo, texto: a.texto }));
  const payload = {
    mode,
    courseName: projeto.nomeCurso,
    tema: projeto.tema,
    aulas,
    model: config.modelo
  };

  let res = null, direto = false;
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

  // Sem backend (site estático)? Tenta o modo direto com a chave salva no navegador.
  if (!res || res.status === 404 || res.status === 405) {
    if (!config.chave) {
      throw new Error('Backend não encontrado. Publique o site no Cloudflare Pages com a ANTHROPIC_API_KEY (veja o README) ou informe sua chave da API em Configurações → Avançado.');
    }
    direto = true;
    const prompt = buildPrompt({ mode, courseName: projeto.nomeCurso, tema: projeto.tema, aulas });
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

  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    let msg = `Erro HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.error || msg;
    } catch { /* mantém msg */ }
    throw new Error(msg);
  }

  // Lê o SSE
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
        texto += ev.delta.text;
        onDelta && onDelta(texto);
      } else if (ev.type === 'message_delta' && ev.delta?.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        throw new Error(ev.error?.message || 'Erro no streaming da API.');
      }
    }
  }
  if (stopReason === 'max_tokens') {
    throw new Error('A resposta atingiu o limite de tokens antes de terminar. Tente novamente (ou divida o curso em menos aulas por volume).');
  }
  return { texto, direto };
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
    // tenta remover vírgulas penduradas comuns
    try { return JSON.parse(bruto.replace(/,\s*([}\]])/g, '$1')); }
    catch { throw new Error('O JSON gerado veio com defeito. Clique de novo no volume para regenerar.'); }
  }
}

/* ---------------- sugestão de temas ---------------- */
async function sugerirTemas() {
  if (!(await garantirTranscricoes())) return;
  if (!aulasProntas().length) { toast('Cole o link da aula (ou a transcrição) no passo 2 primeiro.', true); return; }
  if (config.modo === 'claude') { copiarPedido('temas'); return; }
  const btn = $('#btnTemas');
  btn.disabled = true; btn.textContent = 'Pensando nos temas…';
  try {
    const { texto } = await chamarClaude({ mode: 'temas' });
    const data = extrairJSON(texto);
    projeto.temas = data.temas || [];
    desenharTemas();
    salvar();
    toast('Temas sugeridos! Clique em um para escolher.');
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
    chip.className = 'tema' + (projeto.tema === t.titulo ? ' ativo' : '');
    chip.textContent = t.titulo;
    chip.title = `${t.descricao || ''}\n${t.porque || ''}`.trim();
    chip.addEventListener('click', () => {
      projeto.tema = t.titulo;
      $('#temaEscolhido').value = t.titulo;
      desenharTemas();
      salvar();
    });
    box.appendChild(chip);
  });
}

/* ---------------- geração dos volumes ---------------- */
async function gerarVolume(mode) {
  if (!(await garantirTranscricoes())) return;
  const prontas = aulasProntas();
  if (!prontas.length) { toast('Cole o link da aula (ou a transcrição) no passo 2 primeiro.', true); return; }
  if (mode === 'vol2') {
    projeto.tema = $('#temaEscolhido').value.trim();
    if (!projeto.tema) { toast('Escolha ou digite o tema do Volume 2 (passo 3).', true); return; }
  }

  if (config.modo === 'claude') { copiarPedido(mode); return; }

  abortCtl = new AbortController();
  const meta = VOL_META[mode];
  $$('.vol').forEach(b => b.disabled = true);
  $('#statusGeracao').classList.remove('oculto');
  $('#statusTitulo').textContent = `Gerando ${meta.rotulo}…`;
  $('#statusDetalhe').textContent = 'Enviando as aulas para o Claude…';

  try {
    const { texto } = await chamarClaude({
      mode,
      signal: abortCtl.signal,
      onDelta: t => {
        $('#statusDetalhe').textContent = `${milhar(t.length)} caracteres gerados · ~${Math.max(1, Math.round(t.length / 2400))} páginas`;
      }
    });
    const dados = extrairJSON(texto);
    if (!dados.paginas || !dados.paginas.length) throw new Error('A apostila veio sem páginas. Gere novamente.');
    projeto.apostilas[mode] = dados;
    salvar();
    mostrarPreview(mode);
    toast(`${meta.rotulo} pronta! Revise o preview e clique em “Salvar PDF”.`);
  } catch (e) {
    if (e.name !== 'AbortError') toast(e.message, true, 10000);
  } finally {
    $('#statusGeracao').classList.add('oculto');
    $$('.vol').forEach(b => b.disabled = false);
    abortCtl = null;
  }
}

/* ---------------- modo grátis (copiar/colar no app do Claude) ---------------- */
async function copiarPedido(mode) {
  const aulas = aulasProntas().map(a => ({ titulo: a.titulo, texto: a.texto }));
  const texto = buildCopyPrompt({ mode, courseName: projeto.nomeCurso, tema: projeto.tema, aulas });
  ultimoPedido = mode;
  if (mode !== 'temas') $('#colarDestino').value = 'auto';

  const nome = mode === 'temas' ? 'sugestão de temas' : VOL_META[mode].rotulo;
  try {
    await navigator.clipboard.writeText(texto);
    toast(`Pedido de ${nome} copiado! Agora: abra uma conversa com o Claude (app ou claude.ai), cole (Ctrl+V) e envie. Quando ele responder, copie a resposta e cole no quadro "Modo grátis" aqui embaixo.`, false, 12000);
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

  // resposta de temas?
  if (dados.temas) {
    projeto.temas = dados.temas;
    desenharTemas();
    salvar();
    $('#colarJson').value = '';
    toast('Temas montados! Clique em um para escolher (passo 3).');
    return;
  }

  if (!dados.paginas || !dados.paginas.length) {
    toast('Essa resposta não tem páginas de apostila. Confira se você copiou a resposta inteira do Claude.', true, 8000);
    return;
  }
  let destino = $('#colarDestino').value;
  if (destino === 'auto') destino = (ultimoPedido && ultimoPedido !== 'temas') ? ultimoPedido : 'vol1';
  projeto.apostilas[destino] = dados;
  salvar();
  $('#colarJson').value = '';
  mostrarPreview(destino);
  toast(`${VOL_META[destino].rotulo} montada! Revise o preview e clique em “Salvar PDF”.`);
}

function atualizarModoUI() {
  const gratis = config.modo === 'claude';
  $('#painelColar').classList.toggle('oculto', !gratis);
  $('#dicaModo').classList.toggle('oculto', !gratis);
}

/* ---------------- preview / PDF ---------------- */
function mostrarPreview(mode) {
  const dados = projeto.apostilas[mode];
  if (!dados) return;
  volumeAtual = mode;
  const meta = VOL_META[mode];
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
      if (i === 0) return; // capa
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
  $('#modalConfig').showModal();
}

/* ---------------- boot ---------------- */
function boot() {
  try { Object.assign(config, JSON.parse(localStorage.getItem('cess_config_v1') || '{}')); } catch { /* config nova */ }
  if (!config.rodape) config.rodape = RODAPE_PADRAO;
  try {
    const p = JSON.parse(localStorage.getItem('cess_projeto_v1') || 'null');
    if (p) projeto = Object.assign(projeto, p);
  } catch { /* projeto novo */ }
  projeto.aulas.forEach(a => { if (a.usar === undefined) a.usar = true; });

  $('#nomeCurso').value = projeto.nomeCurso;
  $('#temaEscolhido').value = projeto.tema || '';
  if (!projeto.aulas.length) projeto.aulas.push({ url: '', titulo: '', texto: '', status: '' });
  desenharAulas();
  desenharTemas();
  if (projeto.capaImagem) mostrarCapaMini();

  $('#modoGeracao').value = config.modo || 'claude';
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
  $('#temaEscolhido').addEventListener('input', e => { projeto.tema = e.target.value; desenharTemas(); salvar(); });
  $('#btnAddAula').addEventListener('click', () => novaAula());
  $('#btnExtrairTodas').addEventListener('click', extrairTodas);
  $('#chkTodas').addEventListener('change', e => {
    projeto.aulas.forEach(a => { a.usar = e.target.checked; });
    desenharAulas();
    salvar();
  });
  $('#btnTemas').addEventListener('click', sugerirTemas);
  $$('.vol').forEach(b => b.addEventListener('click', () => gerarVolume(b.dataset.mode)));
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
      if (volumeAtual) mostrarPreview(volumeAtual);
    };
    rd.readAsDataURL(file);
  });
  $('#removerCapa').addEventListener('click', () => {
    projeto.capaImagem = null;
    $('#capaPreview').classList.add('oculto');
    $('#fotoCapa').value = '';
    salvar();
    if (volumeAtual) mostrarPreview(volumeAtual);
  });

  // reabre a última apostila gerada, se houver
  const ultimo = ['vol3', 'vol2', 'vol1'].find(m => projeto.apostilas && projeto.apostilas[m]);
  if (ultimo) mostrarPreview(ultimo);
}

function mostrarCapaMini() {
  const box = $('#capaPreview');
  box.classList.remove('oculto');
  box.querySelector('img').src = projeto.capaImagem;
}

boot();
