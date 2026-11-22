import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// BASE_PATH est fourni par le workflow GitHub Pages (ex. "/DAM-Terbis/").
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
})
