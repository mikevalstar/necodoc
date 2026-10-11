import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { tsconfigPaths: true },
  server: {
    // Same-origin /api keeps Better Auth cookies simple.
    // API_PROXY: a second API on another port (e.g. SSO testing).
    proxy: { "/api": process.env.API_PROXY ?? "http://localhost:3000" },
  },
});
