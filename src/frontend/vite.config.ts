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
    },
  },

  build: {
    outDir: "build",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-select",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-progress",
          ],
          "auth-vendor": ["react-oidc-context", "aws-amplify"],
          "filesystem-vendor": ["react-arborist"],
          "monaco-vendor": ["@monaco-editor/react", "monaco-editor"],
        },
      },
    },
  },

  server: {
    port: 3000,
    open: true,
  },
})
