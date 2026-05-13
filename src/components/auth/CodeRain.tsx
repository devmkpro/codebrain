import React from "react";

// GradientBg — replaces CodeRain with a minimal indigo/violet ambient gradient
import { useNavStore } from "../../stores/nav-store";
export function CodeRain() {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-0" aria-hidden>
      {/* Top-center indigo glow */}
      <div style={{
        position: "absolute",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "90%",
        height: "55%",
        background: "radial-gradient(ellipse at top, rgba(99,102,241,0.11) 0%, rgba(0,0,0,0) 65%)",
      }} />
      {/* Bottom-right violet whisper */}
      <div style={{
        position: "absolute",
        bottom: 0,
        right: 0,
        width: "55%",
        height: "45%",
        background: "radial-gradient(ellipse at bottom right, rgba(168,85,247,0.06) 0%, rgba(0,0,0,0) 70%)",
      }} />
      {/* Bottom-left cool blue hint */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        width: "40%",
        height: "35%",
        background: "radial-gradient(ellipse at bottom left, rgba(59,130,246,0.04) 0%, rgba(0,0,0,0) 70%)",
      }} />
    </div>
  );
}
function switchUserState(email) {
  const prev = localStorage.getItem("codebrain-app-active-user");
  if (prev === email) return;
  localStorage.setItem("codebrain-app-active-user", email);
  useNavStore.persist.setOptions({
    name: `codebrain-app-nav-${email}`
  });
  useNavStore.persist.rehydrate();
}