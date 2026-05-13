import React from "react";

// StatusDot
export function StatusDot({
  status
}) {
  const colors = {
    booting: "bg-yellow-500 animate-pulse shadow-[0_0_4px_rgba(234,179,8,0.6)]",
    running: "bg-green-500 animate-pulse shadow-[0_0_4px_rgba(34,197,94,0.6)]",
    idle: "bg-gray-600",
    done: "bg-blue-500",
    error: "bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.6)]"
  };
  return <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${colors[status]}`} />;
}
export function shortenPath(p) {
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.indexOf("/", home.length - 1) + 1);
    return "~/" + rest.split("/").slice(1).join("/");
  }
  const parts = p.split("/");
  return parts.length > 3 ? "…/" + parts.slice(-2).join("/") : p;
}