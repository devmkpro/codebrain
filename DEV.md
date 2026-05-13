# Codebrain — Guia de Desenvolvimento

## Pré-requisitos

- Node.js 20+ 
- npm 10+
- Git (opcional)

## Instalação

```bash
cd codebrain
npm install
```

---

## Modo Dev (edição ao vivo)

```bash
npm run dev
```

Isso inicia:
1. **Vite dev server** na porta `5173` (renderer React com HMR)
2. **Electron** apontando para o dev server

Qualquer mudança em `src/**/*.tsx` recarrega automaticamente o app.

### Editar componentes

| Arquivo | O que faz |
|---------|-----------|
| `src/app/App.tsx` | Componente raiz, teclado global, roteamento por tab |
| `src/views/HomeView.tsx` | Tela inicial (home screen) |
| `src/components/auth/AuthGate.tsx` | Fluxo de autenticação |
| `src/components/terminal/TerminalPane.tsx` | Painel de terminal (xterm.js) |
| `src/components/workspace/WorkspaceView.tsx` | View do workspace com abas |
| `src/components/navigation/WorkspaceTabs.tsx` | Barra de tabs superior |
| `src/stores/nav-store.tsx` | Estado de navegação (Zustand) |
| `src/stores/panes-store.tsx` | Estado dos painéis/terminais |

### Editar processo main

| Arquivo | O que faz |
|---------|-----------|
| `electron/main/index.ts` | Entry point, IPC handlers |
| `electron/main/pty-manager.ts` | Gerenciar terminais (node-pty) |
| `electron/main/auto-updater.ts` | Auto-update com backup automático |
| `electron/main/provider-store.ts` | Salvar configurações de AI providers |
| `electron/preload/index.ts` | Bridge IPC → renderer (contextBridge) |

---

## Build para produção

### Portável (ZIP) — sem precisar de admin

```bash
npm run pack:win
```

Gera: `dist/Codebrain-{versão}-win-x64.zip` (portable)
Basta descompactar e rodar `Codebrain.exe`.

### Instalador NSIS — precisa rodar o terminal como Administrador

```bash
npm run dist:win:nsis
```

Gera: `dist/Codebrain-{versão}-win-x64.exe`

> **Nota:** O electron-builder baixa ferramentas que precisam criar symlinks no Windows.  
> Se der erro de symlink, ative o **Modo Desenvolvedor** (Configurações → Sistema → Para Desenvolvedores → Modo Desenvolvedor) ou rode como Admin.

### Build de todos os artefatos

```bash
npm run dist:win   # ZIP + portable
```

---

## Estrutura do projeto

```
codebrain/
│
├── src/                          # Renderer (React + TypeScript)
│   ├── app/App.tsx               # Componente raiz
│   ├── main.tsx                  # Entry point do renderer
│   ├── index.css                 # Estilos globais (Tailwind v4)
│   ├── index.html                # Template HTML
│   │
│   ├── views/                    # Páginas/views principais
│   │   └── HomeView.tsx
│   │
│   ├── components/               # Componentes React
│   │   ├── auth/                 # Login, AuthGate, Logo
│   │   ├── terminal/             # TerminalPane, TermGrid
│   │   ├── panes/                # BrowserPane, PaneTitle, StatusDot
│   │   ├── layout/               # Grid, RenderNode, DropTarget
│   │   ├── workspace/            # WorkspaceView, FloatingFileWindow
│   │   ├── providers/            # ProvidersModal, ProviderForm
│   │   ├── settings/             # SettingsModal
│   │   ├── navigation/           # WorkspaceTabs, WhatsNewModal
│   │   ├── tasks/                # TasksSidebar
│   │   ├── squads/               # SquadModal
│   │   ├── session/              # SessionMap
│   │   ├── files/                # FileTree, Editor
│   │   └── diagnostics/          # DiagnosticsModal
│   │
│   ├── stores/                   # Estado global (Zustand)
│   │   ├── nav-store.tsx         # Navegação/tabs
│   │   ├── panes-store.tsx       # Painéis (terminais/browser)
│   │   ├── auth-store.tsx        # Estado de auth
│   │   ├── providers-store.tsx   # AI providers
│   │   ├── terminal-settings-store.tsx
│   │   ├── workspace-store.tsx
│   │   ├── tasks-store.tsx
│   │   ├── squads-store.tsx
│   │   ├── voice-store.tsx
│   │   ├── editor-store.tsx
│   │   └── browser-store.tsx
│   │
│   └── types/                    # TypeScript types
│       ├── electron.d.ts         # API do window.codeBrainApp
│       ├── pane.ts               # Tipos de painel
│       └── nav.ts                # Tipos de navegação
│
├── electron/
│   ├── main/                     # Processo Electron main
│   │   ├── index.ts              # Entry + IPC handlers
│   │   ├── pty-manager.ts        # Terminais (node-pty)
│   │   ├── auto-updater.ts       # Auto-update + backup
│   │   ├── provider-store.ts     # Config de providers
│   │   ├── config-store.ts       # Config do app
│   │   ├── workspace-config-store.ts
│   │   ├── cli-detector.ts       # Detecção de CLI tools
│   │   ├── output-buffer.ts      # Buffer de saída PTY
│   │   ├── idle-detector.ts      # Detecção de idle
│   │   └── platform.ts           # Detecção de OS
│   │
│   └── preload/
│       └── index.ts              # contextBridge API
│
├── resources/
│   └── icon.ico                  # Ícone do app
│
├── scripts/
│   └── build-exe.mjs             # Script de build portável
│
├── electron.vite.config.ts       # Config do bundler
├── tsconfig.json                 # TS config raiz
├── tsconfig.web.json             # TS config renderer
├── tsconfig.node.json            # TS config main/preload
└── package.json
```

---

## Auto-Update com Backup

O módulo `electron/main/auto-updater.ts` cria automaticamente um backup do `app.asar` antes de instalar atualizações:

- Backup salvo em: `%AppData%\Codebrain\asar-backups\app-{versão}-{timestamp}.asar`
- Últimas 3 versões mantidas
- Para restaurar manualmente: chame `restoreFromBackup()` do módulo

---

## Adicionar imports entre componentes

Os componentes foram extraídos de um bundle monolítico, então não têm imports entre si ainda.  
Para usar um store em um componente, adicione no topo do arquivo:

```tsx
// Exemplo: usar o store de panes no TerminalPane
import { usePanesStore } from '../../stores/panes-store';
```
