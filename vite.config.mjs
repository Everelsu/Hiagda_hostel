import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import vue from "@vitejs/plugin-vue"

export default defineConfig({
	root: "web",
	plugins: [vue()],
	resolve: {
		alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) },
	},
	build: {
		outDir: fileURLToPath(new URL("./dist", import.meta.url)),
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: false,
		proxy: {
			"/api": "http://localhost:3000",
			"/kiosk": "http://localhost:3000",
		},
	},
})
