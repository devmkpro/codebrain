import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App, { AppErrorBoundary } from "./app/App";
const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");
createRoot(container).render(<AppErrorBoundary>
    <App />
  </AppErrorBoundary>);