import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-192.png", "icon-512.png", "wasm/*.wasm"],
      manifest: {
        name: "OnboardCode",
        short_name: "OnboardCode",
        description: "브라우저 안에서만 동작하는 로컬 코드 그래프 노트",
        theme_color: "#11151d",
        background_color: "#11151d",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,wasm}"],
        navigateFallback: `${base}index.html`,
      },
    }),
  ],
  build: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
});
