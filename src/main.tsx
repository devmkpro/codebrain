import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App, { AppErrorBoundary } from "./app/App";
import { registerCoreActions } from "./actions/core-actions";

// Popula o registro de ações antes da primeira renderização, para que o
// command palette e os atalhos globais já estejam completos no boot.
registerCoreActions();

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
createRoot(container).render(<AppErrorBoundary>
    <App />
  </AppErrorBoundary>);