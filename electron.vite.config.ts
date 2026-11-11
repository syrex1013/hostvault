import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import { resolve } from 'node:path'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('src/main/index.ts') } } } },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') }, output: { format: 'cjs', entryFileNames: '[name].js' } } } },
  renderer: {
    root: 'src/renderer', plugins: [react()],
    css: { postcss: { plugins: [tailwindcss({ config: resolve('tailwind.config.cjs') }), autoprefixer()] } },
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
})
