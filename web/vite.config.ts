import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    obfuscatorPlugin({
      include: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.tsx'],
      exclude: [/node_modules/, /src\/pkg\/.*\.js/, /src\/services\/wasm\.ts/],
      apply: 'build',
      debugger: true,
      options: {
        compact: true,
        // controlFlowFlattening disabled 2026-05-01 — broke multi-device
        // hardware-marker path (while-loop mutation in drawHardwareMarkerVisualOnly
        // + ref-callback patterns in useDevice broadcast listener crashed as
        // `he is not a function`). Other transforms remain.
        controlFlowFlattening: false,
        numbersToExpressions: true,
        simplify: true,
        stringArrayShuffle: true,
        splitStrings: false,
        stringArrayThreshold: 0.8,
        unicodeEscapeSequence: false,
        identifierNamesGenerator: 'hexadecimal'
      }
    })
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
