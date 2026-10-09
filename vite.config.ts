import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: {
        index: page("index.html"),
        continuity: page("continuity/index.html"),
      },
    },
  },
});
