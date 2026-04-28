# asTube

Aplicativo desktop para download de vídeos e áudios do YouTube.

> **Aviso legal**
> Este projeto foi desenvolvido com fins **exclusivamente didáticos**, como estudo prático de Electron, TypeScript, IPC, testes unitários e boas práticas de segurança em aplicações desktop.
>
> O download de conteúdo do YouTube pode violar os [Termos de Serviço da plataforma](https://www.youtube.com/t/terms), em especial a cláusula que proíbe o download de conteúdo sem autorização expressa. Use esta ferramenta apenas com conteúdo próprio, com conteúdo licenciado para download (Creative Commons, domínio público, etc.) ou com a permissão do detentor dos direitos. O autor não se responsabiliza pelo uso indevido do software.

---

## Funcionalidades

- **Download de vídeo único** — cole a URL e baixe em MP4 ou MP3
- **Download de playlist** — baixa todos os vídeos de uma playlist do YouTube, com numeração automática
- **Download em lote (batch)** — importe um arquivo `.txt` com uma URL por linha e baixe todos de uma vez
- **Seleção de formato** — escolha entre MP4 (vídeo) ou MP3 (somente áudio, qualidade máxima VBR)
- **Seleção de resolução** — Melhor disponível, 4K, 1080p, 720p, 480p, 360p (para MP4)
- **Pasta de saída configurável** — escolha onde os arquivos serão salvos
- **Barra de progresso** — exibe percentual, velocidade, ETA e tamanho total
- **Log em tempo real** — acompanhe o status de cada download
- **Cancelamento** — interrompa qualquer download em andamento
- **Compatibilidade macOS** — prioriza H.264 + AAC para máxima compatibilidade com QuickTime
- **yt-dlp automático** — detecta instalação do sistema ou baixa o binário automaticamente

---

## Tecnologias

| Camada | Tecnologia |
|---|---|
| Framework desktop | [Electron](https://www.electronjs.org/) v41 |
| Build / bundler | [electron-vite](https://electron-vite.org/) + Vite 6 |
| Linguagem | TypeScript 5 |
| Download de vídeo | [yt-dlp-wrap](https://github.com/foxesdocode/yt-dlp-wrap) (wrapper do yt-dlp) |
| Conversão de áudio/vídeo | [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) (ffmpeg embutido) |

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18 ou superior
- npm 9 ou superior
- *(Opcional)* [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado no sistema — se não encontrado, é baixado automaticamente

---

## Instalação e execução

```bash
# Clone o repositório
git clone <url-do-repositorio>
cd astube

# Instale as dependências
npm install

# Inicie em modo desenvolvimento
npm run dev
```

---

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Inicia o app em modo desenvolvimento com hot reload |
| `npm run build` | Compila o projeto para produção em `out/` |
| `npm run preview` | Pré-visualiza o build de produção |
| `npm run package` | Gera o instalador distribuível (`.dmg` no macOS, `.exe` no Windows) |
| `npm test` | Executa todos os testes uma vez |
| `npm run test:watch` | Executa os testes em modo watch (re-executa ao salvar) |
| `npm run test:coverage` | Executa os testes com relatório de cobertura de código |

---

## Uso

### Download de vídeo único
1. Selecione a aba **Vídeo**
2. Cole a URL do YouTube no campo de texto
3. Escolha o **Formato** (MP4 ou MP3) e a **Resolução** desejada
4. Clique em **Baixar**

### Download de playlist
1. Selecione a aba **Playlist**
2. Cole a URL da playlist do YouTube
3. Escolha o formato e a resolução
4. Clique em **Baixar** — os vídeos serão baixados numerados em sequência

### Download em lote
1. Crie um arquivo `.txt` com uma URL por linha:
   ```
   https://youtube.com/watch?v=...
   https://youtube.com/watch?v=...
   https://youtube.com/watch?v=...
   ```
2. Selecione a aba **Lote**
3. Clique em **Procurar** e selecione o arquivo `.txt`
4. Escolha o formato (MP4 ou MP3)
5. Clique em **Baixar** — os downloads ocorrem sequencialmente

> **Dica:** Ao selecionar o formato **MP3**, o seletor de resolução é desativado automaticamente, pois não se aplica a downloads de áudio.

---

## Testes

O projeto usa [Vitest](https://vitest.dev/) como runner de testes.

```bash
# Executa todos os testes
npm test

# Modo watch — re-executa automaticamente ao salvar arquivos
npm run test:watch

# Gera relatório de cobertura em coverage/
npm run test:coverage
```

Os arquivos de teste ficam em `src/__tests__/`:

| Arquivo | O que testa |
|---|---|
| `downloader.test.ts` | Classe `Downloader` — inicialização do binário, argumentos do yt-dlp para MP4/MP3, downloads single/playlist/batch, callbacks de progresso, cancelamento |
| `utils.test.ts` | Funções utilitárias — `parseUrls`, `clampPercent`, `formatQualityLabel` |

---

## Estrutura do projeto

```
astube/
├── src/
│   ├── main/
│   │   ├── index.ts              # Processo principal do asTube, handlers IPC
│   │   ├── downloader.ts         # Lógica de download (yt-dlp wrapper)
│   │   └── yt-dlp-adapter.ts     # Adaptador do yt-dlp (isolado para testabilidade)
│   ├── preload/
│   │   └── index.ts              # Bridge segura entre main e renderer
│   └── renderer/
│       ├── index.html            # Interface do usuário
│       └── src/
│           ├── main.ts           # Lógica da UI e eventos
│           ├── utils.ts          # Funções utilitárias puras
│           └── style.css         # Estilos
├── src/__tests__/
│   ├── downloader.test.ts        # Testes do Downloader
│   └── utils.test.ts             # Testes dos utilitários
├── vitest.config.ts              # Configuração dos testes
├── electron.vite.config.ts       # Configuração do build
├── package.json
└── tsconfig.json
```

---

## Distribuição

Para gerar o instalador final:

```bash
npm run package
```

O arquivo gerado ficará em `dist/`:
- **macOS** → `asTube-<versão>.dmg`
- **Windows** → `asTube Setup <versão>.exe`

---

## Licença

MIT
