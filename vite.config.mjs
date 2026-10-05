import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// The smart mask runs an AI model with onnxruntime-web (WebAssembly). Its engine files are copied next to the
// built page, where the app loads them from (dist/ort).
const copyOrt = () => ({
  name: 'copy-onnxruntime-engine',
  closeBundle() {
    const from = path.resolve('node_modules/onnxruntime-web/dist')
    const to = path.resolve('dist/ort')
    fs.mkdirSync(to, { recursive: true })
    for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) fs.copyFileSync(path.join(from, f), path.join(to, f))
  },
})

export default defineConfig({
  plugins: [react(), copyOrt()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
})
