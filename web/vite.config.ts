import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'

import obfuscatorPlugin from 'vite-plugin-javascript-obfuscator'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Obfuscator temporarily disabled 2026-05-01 — `controlFlowFlattening`
    // breaks the new multi-device hardware-marker code path (`he is not a
    // function` crash on hardware event with 2+ devices). Re-enable after
    // identifying the offending pattern in the broadcast listener / setEventMarkersRef path.
    // obfuscatorPlugin({
    //   include: ['src/**/*.js', 'src/**/*.ts', 'src/**/*.tsx'],
    //   exclude: [/node_modules/, /src\/pkg\/.*\.js/, /src\/services\/wasm\.ts/],
    //   apply: 'build',
    //   debugger: true,
    //   options: {
    //     compact: true,
    //     controlFlowFlattening: true,
    //     controlFlowFlatteningThreshold: 0.5,
    //     numbersToExpressions: true,
    //     simplify: true,
    //     stringArrayShuffle: true,
    //     splitStrings: false,
    //     stringArrayThreshold: 0.8,
    //     unicodeEscapeSequence: false,
    //     identifierNamesGenerator: 'hexadecimal'
    //   }
    // })
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
