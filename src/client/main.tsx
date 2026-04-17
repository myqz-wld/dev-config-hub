import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

window.addEventListener("unhandledrejection", (e) => {
  document.body.style.background = "#0d1117";
  document.body.style.color = "#f85149";
  document.body.style.padding = "40px";
  document.body.style.fontFamily = "monospace";
  document.body.innerHTML = `<h2>Error</h2><pre>${e.reason}</pre>`;
});

try {
  createRoot(document.getElementById("root")!).render(<App />);
} catch (e) {
  document.body.style.background = "#0d1117";
  document.body.style.color = "#f85149";
  document.body.style.padding = "40px";
  document.body.innerHTML = `<h2>Render Error</h2><pre>${e}</pre>`;
}
