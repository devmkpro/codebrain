/**
 * xterm-exports.ts
 *
 * Provides the same exports that TerminalPane.tsx expects, now sourced
 * from the proper @xterm/* npm packages instead of the decompiled HomeView bundle.
 *
 * Also re-exports react-resizable-panels components under the names used by
 * RenderNode.tsx (Ut = PanelGroup, Yt = Panel, Qt = PanelResizeHandle).
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
// react-resizable-panels v4: exports are Group, Panel, Separator
import { Group, Panel, Separator } from 'react-resizable-panels';

// ── xterm ──────────────────────────────────────────────────────
// Matches: new xtermExports.Terminal({ ... })
export const xtermExports = { Terminal };

// Matches: new addonFitExports.FitAddon()
export const addonFitExports = { FitAddon };

// Matches: new L(openWebLink)
export { WebLinksAddon as L };

// ── react-resizable-panels ─────────────────────────────────────
// RenderNode.tsx uses: Ut (PanelGroup), Yt (Panel), Qt (PanelResizeHandle)
export { Group as Ut, Panel as Yt, Separator as Qt };
