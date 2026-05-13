import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import monacoEditorPlugin from "vite-plugin-monaco-editor"
import path from "path"

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService"],
    }),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "roughjs/bin/rough": path.resolve(__dirname, "node_modules/roughjs/bin/rough.js"),
    },
  },

  build: {
    outDir: "build",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-router-dom") || id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) {
            return "react-vendor"
          }
          if (
            id.includes("node_modules/@radix-ui/react-dialog") ||
            id.includes("node_modules/@radix-ui/react-select") ||
            id.includes("node_modules/@radix-ui/react-alert-dialog") ||
            id.includes("node_modules/@radix-ui/react-progress")
          ) {
            return "ui-vendor"
          }
          if (id.includes("node_modules/react-oidc-context") || id.includes("node_modules/aws-amplify")) {
            return "auth-vendor"
          }
          if (id.includes("node_modules/react-arborist")) {
            return "filesystem-vendor"
          }
          if (id.includes("node_modules/@monaco-editor/react") || id.includes("node_modules/monaco-editor")) {
            return "monaco-vendor"
          }
          if (id.includes("node_modules/@excalidraw/mermaid-to-excalidraw")) {
            return "excalidraw-mermaid"
          }
          if (
            id.includes("node_modules/@excalidraw/common") ||
            id.includes("node_modules/@excalidraw/element") ||
            id.includes("node_modules/@excalidraw/math") ||
            id.includes("node_modules/@excalidraw/fractional-indexing") ||
            id.includes("node_modules/@excalidraw/laser-pointer")
          ) {
            return "excalidraw-support"
          }
          if (id.includes("node_modules/pako")) {
            return "compression-vendor"
          }
          if (id.includes("node_modules/framer-motion") || id.includes("node_modules/motion-")) {
            return "motion-vendor"
          }
          if (id.includes("node_modules/refractor")) {
            return "syntax-vendor"
          }
        },
      },
    },
  },

  server: {
    port: 3000,
    open: true,
  },
})
