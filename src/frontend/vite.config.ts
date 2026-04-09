import path from "node:path";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const DEFAULT_API_PROXY_TARGET = "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET ?? DEFAULT_API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          editor: ["@monaco-editor/react"],
          graph: ["@xyflow/react"],
          tree: ["react-complex-tree"],
        },
      },
    },
  },
});
