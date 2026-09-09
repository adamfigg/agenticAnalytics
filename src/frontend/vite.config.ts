import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { benchApi } from "../backend/server/bench_api";

export default defineConfig({
  // benchApi runs the real pipeline inside the dev server, so the test bench
  // needs no second process and no proxy. It is `apply: "serve"` only.
  plugins: [react(), benchApi()],
  root: "src/frontend",
  server: {
    // Bind IPv4 loopback explicitly. Vite's default resolves `localhost` to ::1
    // on Windows and then listens on IPv6 ONLY, so http://127.0.0.1:5173 is
    // refused and any browser that reaches for IPv4 first sees nothing at all.
    // Loopback rather than 0.0.0.0 on purpose: the bench runs the real pipeline
    // and can spend the API key, so it should not be reachable from the network.
    host: "127.0.0.1",
    port: 5173,
  },
});
