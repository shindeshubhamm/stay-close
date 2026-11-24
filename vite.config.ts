import { defineConfig } from "vite";

// In dev, Vite serves the client and proxies the game WebSocket to the Bun server.
export default defineConfig({
  server: {
    open: true,
    // Allow access through tunnels (Cloudflare etc.); Vite blocks unknown Host headers by default.
    allowedHosts: [".trycloudflare.com"],
    proxy: { "/ws": { target: "ws://localhost:3001", ws: true } },
  },
});
