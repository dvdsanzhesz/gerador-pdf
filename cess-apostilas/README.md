# CESS — Gerador de Apostilas

Transforma aulas do YouTube em apostilas em PDF no padrão visual do **Centro Educacional Sete de Setembro (CESS)** — substituindo o fluxo NotebookLM + Gamma por uma ferramenta só.

**O que ele faz:**

1. Você cola os links das aulas do YouTube → o site extrai as transcrições sozinho (com opção de colar manualmente ou enviar arquivo .txt/.srt).
2. O Claude sugere temas complementares e gera os 3 volumes:
   - **Volume 1** — Principais insights da 1ª aula
   - **Volume 2** — Guia do tema complementar (sugerido pela IA ou escolhido por você)
   - **Volume 3** — Manual completo do curso
3. A apostila aparece diagramada no padrão CESS (logo no topo, cards, timelines, tabelas, rodapé oficial) e você salva em **PDF** com um clique.

## Os dois modos de geração

**✅ Modo grátis (padrão) — pelo app do Claude, sem chave de API.**
O site prepara tudo e a "inteligência" vem da sua assinatura normal do Claude:

1. No passo 4, deixe **"Grátis — pelo app do Claude"** selecionado e clique no volume desejado → o site **copia um pedido pronto** (com as transcrições e todas as instruções embutidas).
2. Abra uma conversa no Claude (app ou claude.ai), **cole e envie**.
3. O Claude responde com um código (JSON). Copie a resposta **inteira**, volte ao site e cole no quadro **"Modo grátis"** → clique em **Montar apostila**.
4. Pronto: preview no padrão CESS → **Salvar PDF**. O botão **Sugerir temas** funciona do mesmo jeito (cola o pedido, traz a resposta de volta).

Não paga nada além da assinatura do Claude que você já tem. *(Dica: para o Volume 3 de cursos longos, prefira fazer isso pelo claude.ai no computador.)*

**⚙️ Modo automático (opcional) — com chave da API.**
Tudo acontece com um clique só, sem copiar e colar — ideal para equipe ou uso intenso. Requer a variável `ANTHROPIC_API_KEY` (passo 3 da publicação abaixo) e créditos na platform.claude.com (pago por uso). Selecione **"Automático"** no passo 4 do site.

---

## Como publicar (uma vez só)

O repositório funciona nos **dois formatos** do Cloudflare, conectado ao GitHub:

- **Worker** (fluxo novo: *Import a repository* — o painel usa `npx wrangler deploy`): funciona direto, sem configurar nada — o arquivo `wrangler.jsonc` já cuida de tudo.
- **Pages** (fluxo clássico, abaixo): também funciona.

Nos dois casos, o site sobe grátis e a extração de transcrição já funciona. A chave da API (passo 3) só é necessária para o **modo automático**.

### 1. Suba os arquivos no GitHub

1. Crie um repositório novo no GitHub (ex.: `cess-apostilas`). Pode ser **privado**.
2. Envie **todos os arquivos desta pasta** para o repositório (arrastando na tela *uploading an existing file*, ou via git).

### 2. Conecte no Cloudflare Pages

1. No painel do Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**.
2. Escolha o repositório `cess-apostilas`.
3. Configuração de build — deixe tudo vazio:
   - **Framework preset:** None
   - **Build command:** (vazio)
   - **Build output directory:** `/`
4. Clique em **Save and Deploy**.

### 3. Configure a chave da API (só para o modo automático — pode pular)

1. Pegue sua chave em [platform.claude.com](https://platform.claude.com) → API Keys (começa com `sk-ant-...`).
2. No projeto do Pages: **Settings → Variables and Secrets → Add**:
   - Nome: `ANTHROPIC_API_KEY`
   - Valor: sua chave
   - Tipo: **Secret** · Ambiente: **Production** (e Preview, se quiser)
3. Vá em **Deployments → Retry deployment** (ou faça qualquer novo commit) para a variável valer.

Pronto — o site fica no endereço `https://cess-apostilas.pages.dev` (ou o domínio que você apontar).

---

## Como usar no dia a dia

1. **Curso** — nome do curso e foto de capa são opcionais (sem foto, sai um fundo elegante do CESS; sem nome, o Claude deduz pelo conteúdo).
2. **Aulas** — cole o link de cada aula e pronto: ao clicar no volume, o site puxa as transcrições sozinho. (O botão **Puxar transcrição** é opcional, só para conferir antes.)
3. **Tema do Volume 2** — clique em **Sugerir temas com IA** e escolha um (ou digite o seu).
4. **Gerar** — clique no volume desejado. No modo grátis, siga o copiar/colar descrito acima; no automático, a apostila aparece sozinha em ~1 a 4 minutos.
5. **Salvar PDF** — na janela de impressão escolha:
   - Destino: **Salvar como PDF**
   - Margens: **Nenhuma**
   - **Ativar “Gráficos de fundo”** (senão as cores não saem!)
6. Se quiser ajustar alguma frase antes de salvar, clique em **✎ Editar texto** e edite direto no preview.

O projeto (aulas, temas e apostilas geradas) fica salvo no navegador — você pode fechar e continuar depois.

---

## Perguntas frequentes

**O vídeo precisa de legenda?**
Sim — a extração usa as legendas do YouTube (as automáticas servem). Se o vídeo não tiver, ou a extração falhar, use *colar transcrição manualmente* (no YouTube: descrição do vídeo → **Mostrar transcrição** → copiar).

**A extração automática falhou, e agora?**
Acontece às vezes (o YouTube bloqueia alguns acessos automáticos). O modo manual funciona sempre: abra *colar transcrição manualmente* na aula e cole o texto.

**Quanto custa cada apostila?**
No **modo grátis**: nada além da assinatura do Claude que você já tem (vale o limite de uso normal do seu plano). No **modo automático**: o custo é o da API da Anthropic (paga por uso). Para economizar na API, dá para trocar o modelo em **⚙ Configurações** (Haiku é o mais barato; Fable 5 é o de maior qualidade).

**Uma página ficou com conteúdo “vazando”?**
O preview marca a página com um aviso vermelho. Use **✎ Editar texto** para encurtar, ou gere o volume de novo.

**O deploy falhou com "Could not detect a directory containing static files"?**
Esse erro acontecia quando o projeto era criado como **Worker** sem o arquivo `wrangler.jsonc`. As versões atuais do repositório já incluem esse arquivo (e o `worker.js`) — suba todos os arquivos de novo no GitHub e o deploy roda sozinho. Se estiver usando Worker, a variável `ANTHROPIC_API_KEY` (modo automático) vai em: **seu Worker → Settings → Variables and Secrets**.

**Dá para usar sem o Cloudflare (ex.: GitHub Pages)?**
Dá, mas aí não existe backend: a extração automática de transcrição não funciona (use o modo manual) e você precisa colar sua chave da API em **⚙ Configurações → Avançado** (a chave fica salva só no seu navegador).

---

## Estrutura do projeto

```
index.html        interface do gerador
styles.css        visual da interface
app.js            lógica do app (aulas, temas, geração, preview, PDF)
apostila.js       renderizador: JSON do Claude → páginas A4 no padrão CESS
apostila.css      design system das apostilas (réplica dos PDFs do CESS)
prompts.js        prompts de geração (compartilhado entre backend e navegador)
functions/api/
  transcript.js   extrai a transcrição de um vídeo do YouTube
  generate.js     chama a API da Anthropic com streaming
assets/           logos do CESS e fontes (Gelasio + Inter, self-hosted)
```

Modelo padrão: `claude-fable-5` (pode ser trocado em ⚙ Configurações ou pela variável `CLAUDE_MODEL` no Pages).
