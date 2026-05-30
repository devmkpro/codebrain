import React from "react";

// AuthLayout
import { CodeRain } from "./CodeRain";
import { Logo } from "./Logo";
export function AuthLayout({
  children
}) {
  return <div className="flex-1 flex flex-col items-center justify-center bg-black h-full relative overflow-hidden">
      <CodeRain />
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-[600px] h-[600px] rounded-full bg-white/[0.02] blur-3xl" />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-6 w-80">
        <div className="flex flex-col items-center gap-2">
          <Logo size={48} />
          <span className="font-mono text-[11px] tracking-widest" style={{ color: "#818cf8" }}>codebrain</span>
        </div>
        <div className="text-center">
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight">
            <span style={{ color: "#818cf8" }}>CodeBrain</span>
          </h1>
          <p className="font-mono text-xs text-gray-500 mt-3 tracking-wide">
            Multi-agent AI ADE
          </p>
        </div>
        <div className="flex flex-col gap-3 w-full">{children}</div>
      </div>
    </div>;
}
export function nanoid(size = 12) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = "";
  for (let i = 0; i < size; i++) {
    id += chars[bytes[i] % chars.length];
  }
  return id;
}
export function workspaceForPane(panes, paneId) {
  const pane = panes.find(p => p.id === paneId);
  return pane?.workspacePath ?? pane?.cwd ?? null;
}
export function findLeaf(node, paneId) {
  if (!node) return false;
  if (node.kind === "leaf") return node.paneId === paneId;
  return findLeaf(node.a, paneId) || findLeaf(node.b, paneId);
}
function flattenLeaves(node) {
  if (!node) return [];
  if (node.kind === "leaf") return [node.paneId];
  return [...flattenLeaves(node.a), ...flattenLeaves(node.b)];
}
export function removeLeaf(node, paneId) {
  if (!node) return null;
  if (node.kind === "leaf") return node.paneId === paneId ? null : node;
  const a = removeLeaf(node.a, paneId);
  const b = removeLeaf(node.b, paneId);
  if (!a) return b;
  if (!b) return a;
  return {
    ...node,
    a,
    b
  };
}
function removeLeaves(node, paneIds) {
  if (!node) return null;
  if (node.kind === "leaf") return paneIds.has(node.paneId) ? null : node;
  const a = removeLeaves(node.a, paneIds);
  const b = removeLeaves(node.b, paneIds);
  if (!a) return b;
  if (!b) return a;
  return {
    ...node,
    a,
    b
  };
}
export function insertNextToLeaf(node, targetPaneId, newLeaf, side) {
  if (node.kind === "leaf") {
    if (node.paneId !== targetPaneId) return node;
    const axis = side === "left" || side === "right" ? "h" : "v";
    const targetFirst = side === "right" || side === "bottom";
    return {
      kind: "split",
      axis,
      a: targetFirst ? node : newLeaf,
      b: targetFirst ? newLeaf : node,
      ratio: 50
    };
  }
  return {
    ...node,
    a: insertNextToLeaf(node.a, targetPaneId, newLeaf, side),
    b: insertNextToLeaf(node.b, targetPaneId, newLeaf, side)
  };
}
function appendLeafAtRight(root2, leaf) {
  if (!root2) return leaf;
  return {
    kind: "split",
    axis: "h",
    a: root2,
    b: leaf,
    ratio: 50
  };
}
function isBrowserOnly$1(node, panesById) {
  if (!node) return false;
  if (node.kind === "leaf") return panesById.get(node.paneId)?.kind === "browser";
  return isBrowserOnly$1(node.a, panesById) && isBrowserOnly$1(node.b, panesById);
}
function countColumns(node) {
  if (node.kind === "leaf") return 1;
  if (node.axis === "v") return 1;
  return countColumns(node.a) + countColumns(node.b);
}
export function appendLeafBalanced(root2, leaf) {
  if (!root2) return leaf;
  if (root2.kind === "leaf") {
    return {
      kind: "split",
      axis: "v",
      a: root2,
      b: leaf,
      ratio: 50
    };
  }
  if (root2.axis === "v") {
    return {
      kind: "split",
      axis: "h",
      a: root2,
      b: leaf,
      ratio: 50
    };
  }
  const updatedB = appendLeafBalanced(root2.b, leaf);
  const leftCols = countColumns(root2.a);
  const rightCols = countColumns(updatedB);
  const ratio = leftCols / (leftCols + rightCols) * 100;
  return {
    ...root2,
    b: updatedB,
    ratio
  };
}
function layoutFromLeaves(paneIds) {
  return paneIds.reduce((layout, paneId) => appendLeafBalanced(layout, {
    kind: "leaf",
    paneId
  }), null);
}
function appendWorkLeaf(root2, leaf) {
  if (!root2) return leaf;
  if (root2.kind === "leaf" || root2.axis === "v") return appendLeafAtRight(root2, leaf);
  return appendLeafBalanced(root2, leaf);
}
export function insertWorkLeaf(root2, panes, leaf) {
  if (!root2) return leaf;
  const panesById = new Map(panes.map(p => [p.id, p]));
  const leafIds = flattenLeaves(root2);
  const browserLeafIds = leafIds.filter(paneId => panesById.get(paneId)?.kind === "browser");
  if (browserLeafIds.length === 0) return appendLeafBalanced(root2, leaf);
  const browserLeafIdSet = new Set(browserLeafIds);
  const workArea = isBrowserOnly$1(root2, panesById) ? null : removeLeaves(root2, browserLeafIdSet);
  const browserArea = root2.kind === "split" && root2.axis === "h" && isBrowserOnly$1(root2.b, panesById) ? root2.b : layoutFromLeaves(browserLeafIds);
  const nextWorkArea = appendWorkLeaf(workArea, leaf);
  if (!browserArea) return nextWorkArea;
  const ratio = root2.kind === "split" && root2.axis === "h" && isBrowserOnly$1(root2.b, panesById) ? root2.ratio : 70;
  return {
    kind: "split",
    axis: "h",
    a: nextWorkArea,
    b: browserArea,
    ratio
  };
}