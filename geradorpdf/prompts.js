/* ============================================================
   CESS — Construção dos prompts de geração
   Compartilhado pelo backend (functions/api/generate.js) e pelo
   modo direto no navegador (app.js).
   ============================================================ */

const SCHEMA_DOC = `
FORMATO DA RESPOSTA — responda SOMENTE com um objeto JSON válido (sem cercas de código, sem texto antes ou depois):

{
  "titulo": "Título da apostila para a capa",
  "subtitulo": "Uma ou duas frases que resumem a jornada da apostila.",
  "imagem_capa": "OBRIGATÓRIO: descrição EM INGLÊS de uma foto para a capa (cena fotográfica realista ligada ao tema, ambiente educacional/profissional acolhedor, luz natural; SEM texto, SEM logotipos). Ex.: 'warm classroom scene with a nutritionist explaining food groups to students, natural window light, professional photography'",
  "paginas": [
    { "titulo": "Título da página", "subtitulo": "opcional", "blocos": [ ...blocos... ] }
  ]
}

TIPOS DE BLOCO DISPONÍVEIS (use exatamente estes formatos):
1. Texto corrido: {"tipo":"texto","texto":"Parágrafos separados por linha em branco. Use **negrito** para termos-chave e ==destaque== (no máximo 1 por página) para a frase mais importante."}
2. Subtítulo de seção: {"tipo":"subtitulo","texto":"Subtítulo dentro da página"}
3. Lista: {"tipo":"lista","numerada":false,"itens":["Item com **negrito** opcional.","Outro item."]}
4. Cards: {"tipo":"cards","estilo":"borda","colunas":2,"itens":[{"titulo":"Título do card","texto":"Texto do card."}]}
   - estilos: "borda" (borda lateral colorida — conceitos e mitos), "topo" (faixa colorida no topo com número/ícone — pilares e tipos; acrescente "numerado":true para numerar), "barra" (barra colorida acima do título — etapas leves), "numerado" (01, 02... com régua — protocolos), "citacao" (aspas grandes — perguntas e respostas finais), "contorno" (borda simples).
5. Estatísticas: {"tipo":"stats","itens":[{"valor":"2M","rotulo":"Pessoas no espectro","descricao":"Estimativa para o Brasil."}]} (2 a 4 itens; use apenas números citados nas aulas; dentro do bloco "colunas", acrescente "colunas":1 para empilhar os números)
6. Linha do tempo: {"tipo":"timeline","itens":[{"marco":"1911","texto":"**Primeira aparição do termo:** descrição do marco."}]} (4 a 6 itens)
7. Tabela: {"tipo":"tabela","cabecalho":["Conceito","Descrição"],"linhas":[["Reforço","Aumenta a probabilidade..."]]} (máx. 8 linhas)
8. Callout: {"tipo":"destaque","texto":"Observação importante em caixa cor pêssego."}
9. Ponto-chave: {"tipo":"ponto_chave","texto":"Síntese da seção em uma ou duas frases."}
10. Fluxo com setas: {"tipo":"fluxo","itens":[{"titulo":"Antecedente (A)","texto":"O que acontece antes."}]} (2 a 4 etapas encadeadas)
11. Lista com ícones: {"tipo":"lista_icones","itens":[{"texto":"Mensagem final importante."}]} (4 a 6 itens, para conclusões)
12. Duas colunas: {"tipo":"colunas","proporcao":"1-1","esquerda":[...blocos...],"direita":[...blocos...]} (ex.: texto à esquerda e stats à direita)
13. Imagem ilustrativa: {"tipo":"imagem","prompt":"photo description IN ENGLISH, realistic, no text","legenda":"legenda curta opcional em português"} — inclua 2 a 4 por apostila, em páginas de abertura de módulo, contexto histórico ou cena prática. Nunca em páginas já cheias.
`;

const ESTILO_DOC = `
REGRAS EDITORIAIS (siga com rigor):
- Escreva em português brasileiro, tom didático e profissional, como material autoral do curso. NUNCA mencione "vídeo", "aula gravada", "transcrição" ou "professor disse". Nunca use emojis.
- Fidelidade: o conteúdo deve vir das aulas fornecidas. Não invente estatísticas, autores ou datas que não foram citados; você pode adicionar contextualização didática consolidada da área, sem contradizer as aulas.
- 1 página = 1 assunto. REGRA DURA DE DENSIDADE (a mais importante de todas): TODA página precisa ter no MÍNIMO 3 blocos E ~250 palavras (o ideal é 280–400 palavras em 3 a 5 blocos). É PROIBIDO entregar página com só 1 parágrafo, ou 1 parágrafo + 1 ponto_chave, ou cards com textos de 1 linha — isso deixa a página vazia e feia. Se um assunto rende pouco, FUNDA-O com o assunto vizinho e faça MENOS páginas, mais cheias. Desenvolva os textos dos cards com 2 a 4 frases cada. Também não abarrote: no máximo 2 blocos "grandes" (cards/tabela/timeline/fluxo/stats) por página.
- Varie os componentes ao longo da apostila: alterne texto, cards, tabela, timeline, fluxo, stats, callout. Não repita o mesmo componente em 3 páginas seguidas.
- Conteúdo que É processo/sequência → "fluxo"; história/evolução → "timeline"; comparação → "tabela"; números → "stats"; mitos/conceitos pareados → "cards"; síntese de seção → "ponto_chave".
- Títulos de página: informativos e elegantes (ex.: "Desmistificando Conceitos Iniciais", "A Evolução Histórica da Compreensão do Autismo").
- A capa tem "titulo" (sem a palavra "Volume") e "subtitulo" com 1-2 frases inspiradoras que resumem a jornada.
- Use ==destaque== no máximo 1 vez por página, apenas na frase mais importante.
`;

function xmlAulas(aulas) {
  return (aulas || [])
    .map((a, i) => `<aula numero="${i + 1}"${a.titulo ? ` titulo="${String(a.titulo).replace(/"/g, "'")}"` : ''}>\n${a.texto}\n</aula>`)
    .join('\n\n');
}

export function buildPrompt({ mode, courseName, tema, aulas }) {
  const curso = (courseName || '').trim() || '(não informado — deduza o nome do curso a partir do conteúdo das aulas)';

  if (mode === 'temas') {
    return {
      maxTokens: 3000,
      system: 'Você é o coordenador pedagógico do Centro Educacional Sete de Setembro (CESS). Sua tarefa é sugerir temas para o Volume 2 (guia temático complementar) da apostila de um curso, com base nas transcrições das aulas. Responda SOMENTE com JSON válido, sem cercas de código.',
      user: `Curso: ${curso}

Transcrições das aulas:
${xmlAulas(aulas)}

Sugira exatamente 5 temas para um guia complementar (Volume 2), no formato:
{"temas":[{"titulo":"...","descricao":"1 frase do que o guia cobriria","porque":"1 frase de por que complementa bem o curso"}]}

Diversifique: 1 tema introdutório/fundamentos, 1 prático/aplicado ao dia a dia, 1 de aprofundamento científico, 1 de contexto profissional ou familiar, 1 transversal/atual. Os temas devem nascer do conteúdo das aulas, como faria um bom coordenador pedagógico.`
    };
  }

  const system = `Você é o redator-chefe de apostilas do Centro Educacional Sete de Setembro (CESS). Você transforma o conteúdo de aulas em apostilas didáticas premium, com diagramação editorial rica (no padrão visual do CESS).
${SCHEMA_DOC}
${ESTILO_DOC}`;

  if (mode === 'vol1') {
    return {
      maxTokens: 32000,
      system,
      user: `Curso: ${curso}

Transcrição da primeira aula:
${xmlAulas(aulas.slice(0, 1))}

Produza o VOLUME 1 — "Principais Insights" da aula introdutória: uma apostila de 7 a 9 páginas (além da capa) que destila os principais aprendizados desta primeira aula.
Estrutura típica: fundamentos e relevância do tema (com stats se houver números) → desmistificação de conceitos iniciais (cards) → evolução histórica (timeline, se a aula abordar) → critérios/classificações (tabela ou cards) → aplicação prática → página final de síntese.
Título da capa no padrão: "Principais Insights da Aula Introdutória sobre [tema central]".
Responda somente com o JSON da apostila.`
    };
  }

  if (mode === 'vol2') {
    return {
      maxTokens: 40000,
      system,
      user: `Curso: ${curso}

Transcrições das aulas (material de apoio):
${xmlAulas(aulas)}

Produza o VOLUME 2 — guia temático complementar sobre: "${tema}".
Uma apostila de 9 a 11 páginas (além da capa) que aprofunda esse tema de forma didática e autônoma (o aluno consegue ler sem ter visto as aulas), apoiada no conteúdo das aulas e em conhecimento consolidado da área.
Estrutura típica: introdução desmistificadora → base científica/fundamentos → princípios centrais (cards/fluxo) → como funciona na prática → estratégias/aplicações → página final "Conclusão" com lista_icones das mensagens centrais.
Título da capa no padrão: "Guia [Introdutório/Prático/Completo] [sobre/à] ${tema}".
Responda somente com o JSON da apostila.`
    };
  }

  // vol3 — manual completo
  return {
    maxTokens: 64000,
    system,
    user: `Curso: ${curso}

Transcrições de TODAS as aulas do curso:
${xmlAulas(aulas)}

Produza o VOLUME 3 — "Manual do Curso: ${curso}": o manual completo, com 14 a 18 páginas (além da capa), cobrindo todas as aulas em uma sequência lógica de módulos (fundamentos → conceitos → avaliação/critérios → prática → estratégias).
Use "ponto_chave" ao final das seções principais para consolidar o aprendizado.
Termine com a página "Conclusão: Revisão dos Conceitos Essenciais" usando cards estilo "citacao" com perguntas e respostas (4 a 5) que revisam o curso.
Título da capa no padrão: "Manual do Curso: ${curso}".
Responda somente com o JSON da apostila.`
  };
}

/**
 * Monta um pedido único e auto-contido para o MODO GRÁTIS:
 * o usuário copia este texto e cola numa conversa com o Claude
 * (app/claude.ai, dentro da assinatura normal — sem API).
 */
export function buildCopyPrompt(args) {
  const p = buildPrompt(args);
  return `${p.system}

=====================================================

${p.user}

(IMPORTANTE: responda SOMENTE com o JSON pedido — sem nenhuma frase antes ou depois, sem cercas de código.)`;
}

export default { buildPrompt, buildCopyPrompt };
