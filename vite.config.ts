import { defineConfig } from "vite";

export default defineConfig({
  test: {
    // Cells are real <button> elements, so the unit tests need a DOM.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
  },
});
