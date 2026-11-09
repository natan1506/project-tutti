import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve('src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // O comando `tutti` (src/cli) sai junto do processo principal: out/main/cli.js.
    esbuild: { jsx: 'automatic' },
    // React e Ink empacotados no cli.js: versão de produção (sem avisos de desenvolvimento, mais leve).
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { rollupOptions: { input: { index: resolve('src/main/index.ts'), cli: resolve('src/cli/index.tsx') } } },
  },
  preload: {
    resolve: { alias: shared },
    // renderer com sandbox: true exige preload em CommonJS
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: { resolve: { alias: shared }, plugins: [react()] },
})
