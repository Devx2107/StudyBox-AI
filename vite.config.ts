import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Copies WASM binaries from the @runanywhere npm packages into dist/assets/
 * so they're served alongside the bundled JS at runtime.
 *
 * In dev mode, Vite serves node_modules directly so this only
 * matters for production builds.
 */
function copyWasmPlugin(): Plugin {
  const llamacppWasm = path.resolve(__dir, 'node_modules/@runanywhere/web-llamacpp/wasm');
  const onnxWasm = path.resolve(__dir, 'node_modules/@runanywhere/web-onnx/wasm');

  return {
    name: 'copy-wasm',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dir, 'dist');
      const assetsDir = path.join(outDir, 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });

      // LlamaCpp WASM binaries (LLM/VLM)
      const llamacppFiles = [
        { src: 'racommons-llamacpp.wasm', dest: 'racommons-llamacpp.wasm' },
        { src: 'racommons-llamacpp.js', dest: 'racommons-llamacpp.js' },
        { src: 'racommons-llamacpp-webgpu.wasm', dest: 'racommons-llamacpp-webgpu.wasm' },
        { src: 'racommons-llamacpp-webgpu.js', dest: 'racommons-llamacpp-webgpu.js' },
      ];

      for (const { src, dest } of llamacppFiles) {
        const srcPath = path.join(llamacppWasm, src);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, path.join(assetsDir, dest));
          const sizeMB = (fs.statSync(srcPath).size / 1_000_000).toFixed(1);
          console.log(`  ✓ Copied ${dest} (${sizeMB} MB)`);
        } else {
          console.warn(`  ⚠ Not found: ${srcPath}`);
        }
      }

      // Sherpa-ONNX: copy all files in sherpa/ subdirectory (STT/TTS/VAD)
      const sherpaDir = path.join(onnxWasm, 'sherpa');
      const sherpaOut = path.join(assetsDir, 'sherpa');
      if (fs.existsSync(sherpaDir)) {
        fs.mkdirSync(sherpaOut, { recursive: true });
        for (const file of fs.readdirSync(sherpaDir)) {
          const src = path.join(sherpaDir, file);
          fs.copyFileSync(src, path.join(sherpaOut, file));
          const sizeMB = (fs.statSync(src).size / 1_000_000).toFixed(1);
          console.log(`  ✓ Copied sherpa/${file} (${sizeMB} MB)`);
        }
      }
    },
  };
}

/**
 * Local user-data persistence plugin (dev only).
 *
 * - On server start: if public/userdata.json is missing, copies the template.
 * - POST /__userdata: receives JSON body and writes it to public/userdata.json.
 */
function userdataPlugin(): Plugin {
  const publicDir = path.resolve(__dir, 'public');
  const dataFile = path.join(publicDir, 'userdata.json');
  const templateFile = path.join(publicDir, 'userdata.template.json');

  return {
    name: 'userdata',
    apply: 'serve',

    configureServer(server) {
      // Auto-create userdata.json from template on first run.
      if (!fs.existsSync(dataFile) && fs.existsSync(templateFile)) {
        fs.copyFileSync(templateFile, dataFile);
        console.log('  ✓ [userdata] Created public/userdata.json from template');
      }

      // Write endpoint: POST /__userdata
      server.middlewares.use('/__userdata', (req, res) => {
        if (req.method !== 'POST') {
          res.writeHead(405).end('Method Not Allowed');
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString('utf8');
            // Validate JSON before writing.
            JSON.parse(body);
            fs.writeFileSync(dataFile, body, 'utf8');
            res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
          } catch {
            res.writeHead(400).end('Bad Request');
          }
        });
        req.on('error', () => res.writeHead(500).end('Server Error'));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), copyWasmPlugin(), userdataPlugin()],
  server: {
    headers: {
      // Cross-Origin Isolation — required for SharedArrayBuffer / multi-threaded WASM.
      // Without these headers the SDK falls back to single-threaded mode.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  assetsInclude: ['**/*.wasm'],
  worker: { format: 'es' },
  optimizeDeps: {
    // Exclude WASM-bearing packages from pre-bundling so their
    // import.meta.url resolves correctly to node_modules paths
    // (needed for automatic WASM file discovery at ../../wasm/).
    exclude: ['@runanywhere/web-llamacpp', '@runanywhere/web-onnx'],
  },
});
