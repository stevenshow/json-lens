import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
  },
  // Ensure output is in build directory which is what we specified for Tauri
  build: {
    outDir: "build",
  },
});
