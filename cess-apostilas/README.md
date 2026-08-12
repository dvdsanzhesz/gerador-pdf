# CESS — Gerador de Apostilas

Transforma aulas do YouTube em apostilas em PDF no padrão visual do **Centro Educacional Sete de Setembro (CESS)** — substituindo o fluxo NotebookLM + Gamma por uma ferramenta só.

**O que ele faz:**

1. Você cola os links das aulas do YouTube → o site extrai as transcrições sozinho (com opção de colar manualmente).
2. O Claude (modelo **Fable 5**) sugere temas complementares e gera os 3 volumes:
   - **Volume 1** — Principais insights da 1ª aula
   - **Volume 2** — Guia do tema complementar (sugerido pela IA ou escolhido por você)
   - **Volume 3** — Manual completo do curso
3. A apostila aparece diagramada no padrão CESS (logo no topo, cards, timelines, tabelas, rodapé oficial) e você salva em **PDF** com um clique.

---

## Como publicar (uma vez só)

O site foi feito para o **Cloudflare Pages** (grátis), conectado ao GitHub — igual aos seus outros projetos.

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

### 3. Configure a chave da API (obrigatório)

1. Pegue sua chave em [platform.claude.com](https://platform.claude.com) → API Keys (começa com `sk-ant-...`).
2. No projeto do Pages: **Settings → Variables and Secrets → Add**:
   - Nome: `ANTHROPIC_API_KEY`
   - Valor: sua chave
   - Tipo: **Secret** · Ambiente: **Production** (e Preview, se quiser)
3. Vá em **Deployments → Retry deployment** (ou faça qualquer novo commit) para a variável valer.

Pronto — o site fica no endereço `https://cess-apostilas.pages.dev` (ou o domínio que você apontar).

---

## Como usar no dia a dia

1. **Curso** — digite o nome do curso e, se quiser, envie uma foto para a capa (sem foto, sai um fundo elegante do CESS).
2. **Aulas** — cole o link de cada aula e clique em **Puxar transcrição**. Adicione quantas aulas o curso tiver.
3. **Tema do Volume 2** — clique em **Sugerir temas com IA** e escolha um (ou digite o seu).
4. **Gerar** — clique no volume desejado. A apostila aparece no preview em ~1 a 4 minutos.
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
O custo é o da API da Anthropic (paga por uso, na sua conta). O Volume 3 é o mais longo. Para economizar, dá para trocar o modelo em **⚙ Configurações** (Haiku é o mais barato; Fable 5 é o de maior qualidade).

**Uma página ficou com conteúdo “vazando”?**
O preview marca a página com um aviso vermelho. Use **✎ Editar texto** para encurtar, ou gere o volume de novo.

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
