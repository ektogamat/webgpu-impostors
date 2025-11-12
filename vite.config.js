import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Expose server on network
    port: 3000,
    open: true,
  },
  build: {
    outDir: "dist",
    sourcemap: false, // Disable sourcemaps to hide source code in production
  },
  optimizeDeps: {
    include: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/rapier",
    ],
  },
});
