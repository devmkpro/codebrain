import React from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// FONT_OPTIONS, useTerminalSettings, TERMINAL_THEMES
export const FONT_OPTIONS = [{
  id: "system",
  label: "Sistema",
  stack: '"SF Mono", Menlo, Monaco, Consolas, "Cascadia Code", "Courier New", monospace'
}, {
  id: "cascadia",
  label: "Cascadia Code",
  stack: '"Cascadia Code", "Cascadia Mono", Consolas, monospace'
}, {
  id: "consolas",
  label: "Consolas",
  stack: 'Consolas, "Lucida Console", monospace'
}, {
  id: "menlo",
  label: "Menlo",
  stack: 'Menlo, "SF Mono", Monaco, monospace'
}, {
  id: "courier",
  label: "Courier New",
  stack: '"Courier New", Courier, monospace'
}];
export const DEFAULT_SIZE = 12;
export const MIN_SIZE = 8;
export const MAX_SIZE = 24;

/** Scrollback buffer sizes per performance profile */
export const SCROLLBACK_OPTIONS = [
  { id: 'minimal',  label: 'Mínimo (500 linhas)',    value: 500  },
  { id: 'low',      label: 'Baixo (1 000 linhas)',   value: 1000 },
  { id: 'medium',   label: 'Médio (5 000 linhas)',   value: 5000 },
  { id: 'high',     label: 'Alto (20 000 linhas)',   value: 20000 },
] as const;

export const useTerminalSettings = create()(persist((set, get) => ({
  fontSize: DEFAULT_SIZE,
  fontFamily: "system",
  lineHeight: 1,
  theme: "dark",
  defaultShellPath: null,
  appZoom: 1,
  cursorBlink: true,
  gpuAcceleration: true,
  lowGpuMode: false,
  // Performance options
  scrollbackSize: 5000 as number,       // xterm scrollback buffer
  reducedAnimations: false as boolean,  // disable motion/framer-motion animations
  disableBackdropBlur: false as boolean,// disable backdrop-blur (GPU-heavy)
  setScrollbackSize: (v: number) => set({ scrollbackSize: v }),
  setReducedAnimations: (v: boolean) => set({ reducedAnimations: v }),
  setDisableBackdropBlur: (v: boolean) => set({ disableBackdropBlur: v }),
  increaseAppZoom: () => set({ appZoom: Math.min(3, +(get().appZoom + 0.1).toFixed(1)) }),
  decreaseAppZoom: () => set({ appZoom: Math.max(0.5, +(get().appZoom - 0.1).toFixed(1)) }),
  resetAppZoom: () => set({ appZoom: 1 }),
  setFontSize: size => set({
    fontSize: Math.max(MIN_SIZE, Math.min(MAX_SIZE, size))
  }),
  increaseFontSize: () => set({
    fontSize: Math.min(MAX_SIZE, get().fontSize + 1)
  }),
  decreaseFontSize: () => set({
    fontSize: Math.max(MIN_SIZE, get().fontSize - 1)
  }),
  resetFontSize: () => set({
    fontSize: DEFAULT_SIZE
  }),
  setFontFamily: id => set({
    fontFamily: FONT_OPTIONS.some(f => f.id === id) ? id : "system"
  }),
  setLineHeight: value => set({
    lineHeight: Math.max(1, Math.min(2, value))
  }),
  setTheme: theme => set({
    theme
  }),
  setCursorBlink: (value: boolean) => set({ cursorBlink: value }),
  setGpuAcceleration: (value: boolean) => set({ gpuAcceleration: value }),
  setLowGpuMode: (value: boolean) => set({ lowGpuMode: value }),
  setDefaultShellPath: path => set({
    defaultShellPath: path && path.trim() ? path.trim() : null
  })
}), {
  name: "codebrain-app-terminal-settings",
  version: 5,
  // Migrate persisted settings across versions.
  migrate: persisted => {
    const p = persisted ?? {};
    if (p && typeof p.lineHeight === "number" && p.lineHeight < 1) {
      p.lineHeight = 1;
    }
    // v3: add new rendering defaults
    if (typeof p.cursorBlink !== "boolean") p.cursorBlink = true;
    if (typeof p.gpuAcceleration !== "boolean") p.gpuAcceleration = true;
    if (typeof p.lowGpuMode !== "boolean") p.lowGpuMode = false;
    // v4: reset appZoom to 1 — Ctrl+= now controls appZoom correctly,
    //     old persisted values < 0.9 or > 1.5 indicate a bad state.
    if (typeof p.appZoom !== "number" || p.appZoom < 0.9 || p.appZoom > 1.5) {
      p.appZoom = 1;
    }
    // v5: new performance options
    if (typeof p.scrollbackSize !== "number") p.scrollbackSize = 5000;
    if (typeof p.reducedAnimations !== "boolean") p.reducedAnimations = false;
    if (typeof p.disableBackdropBlur !== "boolean") p.disableBackdropBlur = false;
    return p;
  }
}));
export const TERMINAL_THEMES = {
  dark: {
    background: "#000000",
    foreground: "#cccccc",
    selectionBackground: "#242736",
    selectionForeground: "#ffffff",
    black: "#000000",
    brightBlack: "#666666",
    red: "#cd3131",
    brightRed: "#f14c4c",
    green: "#0dbc79",
    brightGreen: "#23d18b",
    yellow: "#e5e510",
    brightYellow: "#f5f543",
    blue: "#2472c8",
    brightBlue: "#3b8eea",
    magenta: "#bc3fbc",
    brightMagenta: "#d670d6",
    cyan: "#11a8cd",
    brightCyan: "#29b8db",
    white: "#e5e5e5",
    brightWhite: "#e5e5e5"
  },
  // IBM Carbon "White" theme palette — WCAG AAA contrast on white background.
  // ANSI white/brightWhite intentionally DARK so apps emitting \x1b[37m/\x1b[97m
  // stay readable.
  light: {
    background: "#ffffff",
    foreground: "#161616",
    cursor: "#0f62fe",
    selectionBackground: "rgba(0, 0, 0, 0.4)",
    selectionForeground: "#000000",
    black: "#161616",
    brightBlack: "#393939",
    red: "#da1e28",
    brightRed: "#a2191f",
    green: "#198038",
    brightGreen: "#0e6027",
    yellow: "#b28600",
    brightYellow: "#8e6a00",
    blue: "#0f62fe",
    brightBlue: "#0043ce",
    magenta: "#8a3ffc",
    brightMagenta: "#6929c4",
    cyan: "#1192e8",
    brightCyan: "#00539a",
    white: "#161616",
    brightWhite: "#000000"
  }
};