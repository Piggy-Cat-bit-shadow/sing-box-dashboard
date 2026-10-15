import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  // The Subscription-Userinfo parser lives in the desktop shell (`../src/shared/subscription`)
  // because that is where the fetch happens, but the only test runner in the repository is
  // this workspace's. `@shared` is the desktop shell's own alias for that directory; it is
  // repeated here because vitest resolves through Vite, and a relative path across the
  // workspace boundary resolves in `tsc` and then fails at run time.
  resolve: {
    alias: {
      "@shared": resolve(import.meta.dirname, "..", "src", "shared"),
    },
  },
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  server: {
    port: 5173,
    // Named so a dev-server request for the same directory is served rather than refused.
    fs: {
      allow: [
        resolve(import.meta.dirname),
        resolve(import.meta.dirname, "..", "src", "shared"),
      ],
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      pwaAssets: {
        config: true,
        injectThemeColor: false,
      },
      manifest: {
        name: "Jiejiebox dashboard",
        short_name: "Jiejiebox",
        description: "Web dashboard for sing-box.",
        id: "./",
        start_url: "./",
        scope: "./",
        display: "standalone",
        theme_color: "#181818",
        background_color: "#1e1e1e",
        lang: "en",
        dir: "ltr",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,svg,png,ico,webmanifest}"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "index.html",
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
