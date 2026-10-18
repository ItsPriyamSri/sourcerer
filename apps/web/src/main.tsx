import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.tsx";
import "./styles.css";

/**
 * Entry point.
 *
 * The service worker is registered with `autoUpdate`, so a reseller standing in a
 * warehouse never has to know what a service worker is — the app just keeps working
 * and quietly picks up new versions when there is a connection.
 */
registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
