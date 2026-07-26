import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The portal is a DECOUPLED SPA: it is served from its own host and talks to the
// Frappe bench cross-origin with cookie auth. In dev we proxy `/api` so the
// browser sees same-origin requests and the session cookie sticks without any
// SameSite/CORS negotiation. In production this proxy does not exist — nginx (or
// the static host's rewrite rules) must forward /api to the bench instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_FRAPPE_URL || 'https://bloop.thedaystar.co.za'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          secure: true,
          // Frappe sets the session cookie for its own domain; rewrite it to the
          // dev host so the browser stores and replays it.
          cookieDomainRewrite: 'localhost',
        },
        '/files': { target, changeOrigin: true },
        '/private': { target, changeOrigin: true },
      },
    },
  }
})
