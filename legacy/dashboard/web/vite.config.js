import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
// O Express serve o build a partir de dashboard/web/dist na raiz "/".
// Em dev, o Vite faz proxy de /api e /ws para o servidor do dashboard (porta 3000).
export default defineConfig({
    plugins: [react()],
    base: "/",
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
    },
    server: {
        port: 5173,
        proxy: {
            "/api": "http://localhost:3000",
            "/ws": { target: "ws://localhost:3000", ws: true },
        },
    },
});
