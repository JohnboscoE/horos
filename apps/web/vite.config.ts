import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // One .env at the repo root. Only VITE_* variables are exposed to the browser.
  envDir: fileURLToPath(new URL("../..", import.meta.url)),
  resolve: {
    // shadcn convention: "@/components/ui/...", "@/lib/utils"
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://localhost:8787" },
  },
});
