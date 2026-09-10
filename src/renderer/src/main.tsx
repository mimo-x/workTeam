import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@/app/globals.css";
import { App } from "./app";

document.documentElement.classList.toggle("dark", localStorage.getItem("codex.theme") === "dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
