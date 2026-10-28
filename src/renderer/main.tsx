// Global styles first, so component and page styles imported below can build on them.
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/overlay.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";

// The overlay window must be transparent from its first frame, before React mounts.
if (new URLSearchParams(window.location.search).get("view") === "overlay") {
  document.documentElement.classList.add("overlay-view");
  document.body.classList.add("overlay-view");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
