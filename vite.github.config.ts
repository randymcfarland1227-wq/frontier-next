import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The deploy workflow sets PAGES_BASE from the repo name, so frontier and frontier-next share this file.
  base: process.env.PAGES_BASE || "/frontier/",
  plugins: [
    {
      name: "frontier-static-css",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith("/app/globals.css") || id.endsWith("\\app\\globals.css")) {
          return code
            .replace('@import "tailwindcss";', "")
            .replace("@import 'tailwindcss';", "");
        }
      },
    },
    react(),
  ],
  build: {
    outDir: "dist-pages",
    emptyOutDir: true,
  },
});
