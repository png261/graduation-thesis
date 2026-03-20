import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
