import React from "react";
import { Ut, Yt, Qt } from "../../lib/xterm-exports";

// RenderNode
export function RenderNode({
  node,
  panesById,
  renderLeaf
}) {
  if (node.kind === "leaf") {
    return <div className="h-full w-full">{renderLeaf(node.paneId)}</div>;
  }
  const key = nodeKey(node, panesById);
  return <Ut orientation={node.axis === "h" ? "horizontal" : "vertical"} id={`g-${node.axis}-${key}`} style={{
    height: "100%",
    width: "100%"
  }}>
      <Yt id={`p-a-${key}`} defaultSize={node.ratio} minSize={10}>
        <RenderNode node={node.a} panesById={panesById} renderLeaf={renderLeaf} />
      </Yt>
      <Qt className={`${node.axis === "h" ? "w-[4px] cursor-col-resize" : "h-[4px] cursor-row-resize"} bg-transparent hover:bg-red-500/30 transition-colors`} />
      <Yt id={`p-b-${key}`} defaultSize={100 - node.ratio} minSize={10}>
        <RenderNode node={node.b} panesById={panesById} renderLeaf={renderLeaf} />
      </Yt>
    </Ut>;
}
function isBrowserOnly(node, panesById) {
  if (node.kind === "leaf") return panesById.get(node.paneId)?.kind === "browser";
  return isBrowserOnly(node.a, panesById) && isBrowserOnly(node.b, panesById);
}
function nodeKey(node, panesById) {
  if (node.kind === "leaf") return node.paneId;
  if (node.axis === "h" && isBrowserOnly(node.b, panesById)) {
    return `work-browsers|${nodeKey(node.b, panesById)}`;
  }
  return `${nodeKey(node.a, panesById)}|${nodeKey(node.b, panesById)}`;
}