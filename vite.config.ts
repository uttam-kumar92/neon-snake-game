import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // This line must be inside this function to work!
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/neon-snake-game/',
    plugins: [react()],
  }
})
