import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

const apiProxyTarget = process.env.VITE_DEV_API_PROXY_TARGET ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeAssets: ["apple-touch-icon.png", "pwa-192.svg", "pwa-512.svg", "pwa-maskable.svg"],
      manifest: {
        id: "/",
        name: "Davora",
        short_name: "Davora",
        description: "Nextcloud account-aware file manager through a normalized Worker API.",
        categories: ["productivity", "utilities"],
        lang: "en-US",
        theme_color: "#0f172a",
        background_color: "#020617",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/pwa-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable"
          }
        ],
        screenshots: [
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            form_factor: "wide"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallbackDenylist: [/^\/api\//],
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ request, url }) => request.mode === "navigate" && url.pathname !== "/sw.js" && !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "davora-app-shell",
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [200]
              },
              expiration: {
                maxEntries: 20
              }
            }
          },
          {
            urlPattern: ({ request, url }) => ["script", "style", "worker"].includes(request.destination) && !url.pathname.startsWith("/api/"),
            handler: "NetworkFirst",
            options: {
              cacheName: "davora-shell-assets",
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [200]
              },
              expiration: {
                maxEntries: 256
              }
            }
          }
        ]
      },
      devOptions: {
        enabled: true,
        navigateFallbackAllowlist: [/^(?!\/api\/).*/]
      }
    })
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src")
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["tests/**"]
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: {
      "/api": {
        target: apiProxyTarget,
        changeOrigin: true
      }
    }
  }
});