import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "mask-icon.svg"],
      manifest: {
        name: "Sourcerer — Know what it's worth",
        short_name: "Sourcerer",
        description:
          "Offline-first sourcing copilot for resellers. Identify an item, price it, and decide — with the brain on your own device.",
        theme_color: "#17150F",
        background_color: "#F7F3EA",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        categories: ["shopping", "business", "productivity"],
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        navigateFallback: "/index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // The brain is a separate origin (and may be offline). Never cache its API:
        // a stale price is worse than an honest "offline".
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
