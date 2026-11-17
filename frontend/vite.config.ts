import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Keeps API calls (and later cookies) same-origin in development.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
