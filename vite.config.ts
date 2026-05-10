import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:5174"
    }
  },
  test: {
    exclude: ["node_modules/**", "dist/**", "dist-server/**"]
  }
});
