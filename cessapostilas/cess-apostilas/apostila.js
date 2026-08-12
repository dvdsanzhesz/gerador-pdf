/* ============================================================
   CESS — Renderizador de apostilas
   Converte o JSON estruturado gerado pelo Claude em páginas A4
   com o design system do CESS (apostila.css).
   Módulo ES puro: sem dependências, funciona no navegador e no Node.
   ============================================================ */

const ACCENTS_PAGINA = ['#D9714E', '#B13E6F', '#B12C47', '#25798F'];

const ICONS = {
  alvo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  usuario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7M9 8h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4.5l13 7.5-13 7.5z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H4l2.2-3A8 8 0 1 1 21 12z"/></svg>',
  coracao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20.5S4 15 4 9.7A4.6 4.6 0 0 1 12 6.6a4.6 4.6 0 0 1 8 3.1C20 15 12 20.5 12 20.5z"/></svg>',
  grafico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16M6 16l4-5 3 3 5-7"/></svg>',
  estrela: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9z"/></svg>',
  livro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2z"/><path d="M20 17H6a2 2 0 0 0-2 2"/></svg>',
  mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  menos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  alerta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.1"/></svg>',
  marcador: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"/></svg>',
  lampada: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 1 3.7 10.7c-.7.6-.7 1.3-.7 2.3h-6c0-1 0-1.7-.7-2.3A6 6 0 0 1 12 3z"/></svg>'
};
const CICLO_TOPO = ['mais', 'menos', 'alerta', 'usuario', 'estrela', 'doc'];
const CICLO_FLUXO = ['play', 'usuario', 'check', 'doc', 'alvo', 'chat'];
const CICLO_ILISTA = ['alvo', 'chat', 'coracao', 'check', 'grafico', 'estrela', 'livro', 'lampada'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* markdown-lite: **negrito**, *itálico*, ==destaque colorido== */
function md(s) {
  let t = esc(s);
  t = t.replace(/==([^=]+)==/g, '<span class="destaque-inline">$1</span>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s.,;:!?)<]|$)/g, '$1<em>$2</em>');
  return t;
}

function pars(texto, cls = 'par') {
  return String(texto == null ? '' : texto)
    .split(/\n{2,}/)
    .map(p => p.trim()).filter(Boolean)
    .map(p => `<p class="${cls}">${md(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function cor(i) { return `c${i % 5}`; }
function icone(nome) { return ICONS[nome] || ICONS.alvo; }

/* ---------------- blocos ---------------- */

function bTexto(b) { return pars(b.texto); }

function bSubtitulo(b) { return `<h2 class="pg-sub">${md(b.texto)}</h2>`; }

function bLista(b) {
  const tag = b.numerada ? 'ol' : 'ul';
  const itens = (b.itens || []).map(i => `<li>${md(typeof i === 'string' ? i : i.texto)}</li>`).join('');
  return `<${tag} class="lista">${itens}</${tag}>`;
}

function bCards(b) {
  const estilo = b.estilo || 'borda';
  const itens = b.itens || [];
  const nc = b.colunas || (itens.length === 4 ? 2 : Math.min(3, Math.max(2, itens.length)));
  const cards = itens.map((it, i) => {
    const cc = cor(i);
    const titulo = it.titulo ? `<h3 class="card-titulo">${md(it.titulo)}</h3>` : '';
    const texto = it.texto ? `<div class="card-texto">${pars(it.texto, 'card-texto')}</div>` : '';
    if (estilo === 'topo') {
      const top = it.numero != null || b.numerado
        ? esc(String(it.numero != null ? it.numero : i + 1))
        : icone(it.icone || CICLO_TOPO[i % CICLO_TOPO.length]);
      return `<div class="card card--topo ${cc}"><div class="card-top">${top}</div><div class="card-inner">${titulo}${texto}</div></div>`;
    }
    if (estilo === 'barra') {
      return `<div class="card card--barra ${cc}"><div class="barra"></div>${titulo}${texto}</div>`;
    }
    if (estilo === 'numerado') {
      const num = String(i + 1).padStart(2, '0');
      return `<div class="card card--numerado ${cc}"><div class="num">${num}</div><div class="regua"></div>${titulo}${texto}</div>`;
    }
    if (estilo === 'citacao') {
      return `<div class="card card--citacao ${cc}"><span class="q a">“</span>${titulo}${texto}<span class="q b">”</span></div>`;
    }
    if (estilo === 'contorno') {
      return `<div class="card card--contorno ${cc}">${titulo}${texto}</div>`;
    }
    return `<div class="card card--borda ${cc}">${titulo}${texto}</div>`;
  }).join('');
  return `<div class="grade g${Math.min(4, Math.max(1, nc))}">${cards}</div>`;
}

function bStats(b) {
  const itens = b.itens || [];
  const n = Math.min(4, Math.max(1, b.colunas || itens.length));
  const els = itens.map(it => `
    <div class="stat">
      <div class="stat-valor">${esc(it.valor)}</div>
      <div class="stat-rotulo">${esc(it.rotulo || '')}</div>
      ${it.descricao ? `<div class="stat-desc">${md(it.descricao)}</div>` : ''}
    </div>`).join('');
  return `<div class="stats g${n}">${els}</div>`;
}

function bTimeline(b) {
  const itens = b.itens || [];
  const els = itens.map((it, i) => {
    const lado = i % 2 === 0 ? 'l' : 'r';
    return `<div class="tl-item tl-item--${lado} ${cor(i)}">
      <span class="tl-quadro"></span><span class="tl-tra"></span>
      <div class="tl-marco">${esc(it.marco || '')}</div>
      <div class="tl-texto">${md(it.texto || '')}</div>
    </div>`;
  }).join('');
  return `<div class="timeline">${els}</div>`;
}

function bTabela(b) {
  const head = (b.cabecalho || []).map(h => `<th>${md(h)}</th>`).join('');
  const rows = (b.linhas || []).map(r =>
    `<tr>${(r || []).map(c => `<td>${md(c)}</td>`).join('')}</tr>`).join('');
  return `<div class="tabela-wrap"><table class="tabela"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function bDestaque(b) {
  return `<div class="destaque">${icone('marcador')}<div class="txt">${md(b.texto || '')}</div></div>`;
}

function bPontoChave(b) {
  const t = String(b.texto || '');
  const pref = /^\s*ponto[- ]chave/i.test(t) ? md(t) : `<strong>Ponto-Chave:</strong> ${md(t)}`;
  return `<div class="ponto-chave"><div class="txt">${pref}</div></div>`;
}

function bFluxo(b) {
  const itens = (b.itens || []).slice(0, 5);
  const n = itens.length || 1;
  const setas = itens.map((it, i) =>
    `<div class="seta ${cor(i)}">${icone(it.icone || CICLO_FLUXO[i % CICLO_FLUXO.length])}</div>`).join('');
  const cols = itens.map(it =>
    `<div><h4 class="fluxo-titulo">${md(it.titulo || '')}</h4><p class="fluxo-texto">${md(it.texto || '')}</p></div>`).join('');
  return `<div class="fluxo">
    <div class="fluxo-setas" style="grid-template-columns:repeat(${n},1fr)">${setas}</div>
    <div class="fluxo-cols" style="grid-template-columns:repeat(${n},1fr)">${cols}</div>
  </div>`;
}

function bListaIcones(b) {
  const itens = b.itens || [];
  const els = itens.map((it, i) => `
    <div class="il-item">
      <div class="il-ico ${cor(i)}">${icone((it && it.icone) || CICLO_ILISTA[i % CICLO_ILISTA.length])}</div>
      <div class="il-txt">${md(typeof it === 'string' ? it : it.texto)}</div>
    </div>`).join('');
  return `<div class="ilista g${b.colunas === 1 ? 1 : 2}">${els}</div>`;
}

function bColunas(b) {
  const cls = b.proporcao === '3-2' ? 'p32' : b.proporcao === '2-3' ? 'p23' : 'p11';
  const esq = renderBlocos(b.esquerda || []);
  const dir = renderBlocos(b.direita || []);
  return `<div class="duascol ${cls}"><div>${esq}</div><div>${dir}</div></div>`;
}

const BLOCOS = {
  texto: bTexto,
  subtitulo: bSubtitulo,
  lista: bLista,
  cards: bCards,
  stats: bStats,
  estatisticas: bStats,
  timeline: bTimeline,
  tabela: bTabela,
  destaque: bDestaque,
  ponto_chave: bPontoChave,
  fluxo: bFluxo,
  lista_icones: bListaIcones,
  colunas: bColunas
};

function renderBlocos(blocos) {
  return (blocos || []).map(b => {
    try {
      const fn = BLOCOS[b && b.tipo];
      if (!fn) return '';
      return `<div class="bloco bloco--${esc(b.tipo)}">${fn(b)}</div>`;
    } catch (e) {
      return '';
    }
  }).join('');
}

/* ---------------- páginas ---------------- */

function renderRodape(rodape) {
  const partes = String(rodape || '').split('|').map(s => s.trim()).filter(Boolean);
  return partes.map(esc).join('<span class="sep">|</span>');
}

function renderCapa(data, cfg) {
  const fundo = cfg.capaImagem
    ? `<div class="capa-bg" style="background-image:url('${cfg.capaImagem}')"></div><div class="capa-overlay"></div>`
    : `<div class="capa-gradiente"></div>`;
  return `<section class="sheet sheet--capa">
    ${fundo}
    <div class="sheet-header"><img src="${esc(cfg.logoBranca)}" alt="CESS"></div>
    <div class="sheet-body">
      <h1 class="capa-titulo">${md(data.titulo || '')}</h1>
      ${data.subtitulo ? `<p class="capa-sub">${md(data.subtitulo)}</p>` : ''}
    </div>
    <div class="sheet-footer">${renderRodape(cfg.rodape)}</div>
  </section>`;
}

function renderPagina(pg, idx, cfg) {
  const accent = ACCENTS_PAGINA[idx % ACCENTS_PAGINA.length];
  return `<section class="sheet" style="--pg-accent:${accent}">
    <div class="sheet-header"><img src="${esc(cfg.logo)}" alt="CESS"></div>
    <div class="sheet-body">
      ${pg.titulo ? `<h1 class="pg-titulo">${md(pg.titulo)}</h1>` : ''}
      ${pg.subtitulo ? `<h2 class="pg-sub">${md(pg.subtitulo)}</h2>` : ''}
      ${renderBlocos(pg.blocos)}
    </div>
    <div class="sheet-footer">${renderRodape(cfg.rodape)}</div>
  </section>`;
}

export function renderSheets(data, cfg) {
  const paginas = (data && data.paginas) || [];
  return renderCapa(data || {}, cfg) + paginas.map((p, i) => renderPagina(p, i, cfg)).join('');
}

export function renderApostilaHTML(data, cfg = {}) {
  const c = Object.assign({
    logo: 'assets/logo-cess.png',
    logoBranca: 'assets/logo-cess-branca.png',
    rodape: 'Apostila criada por Centro Educacional Sete de Setembro | Proibida a reprodução ou distribuição',
    capaImagem: null,
    baseHref: ''
  }, cfg);
  const base = c.baseHref ? `<base href="${esc(c.baseHref)}">` : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
${base}
<title>${esc((data && data.titulo) || 'Apostila CESS')}</title>
<link rel="stylesheet" href="assets/fonts/fonts.css">
<link rel="stylesheet" href="apostila.css">
</head>
<body class="apostila">
${renderSheets(data, c)}
</body>
</html>`;
}

export default { renderApostilaHTML, renderSheets };
