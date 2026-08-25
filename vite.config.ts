import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset and data paths work from both the local preview root and
  // the GitHub Pages project subdirectory. Absolute `/assets` paths resolve
  // against chasehaddock.github.io and leave the project page blank.
  base: "./",
  plugins: [react()],
});
