import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    outDir: '.test-dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/parser.ts'),
      formats: ['es'],
      fileName: () => 'parser.js',
    },
  },
});
