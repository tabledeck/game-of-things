import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { networkInterfaces } from "os";

// Function to get the local network IP
function getNetworkIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal addresses
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "network-ip",
      configureServer(server) {
        const ip = getNetworkIP();
        const port = server.config.server.port || 5173;

        server.middlewares.use((req, res, next) => {
          if (req.url === "/api/network-info") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ip, port }));
            return;
          }
          next();
        });
      },
    },
  ],
  server: {
    host: true,
    port: 5173,
  },
});
