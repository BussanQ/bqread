import { defineConfig } from 'vite';
import { createApiHandler } from './server/api.mjs';

function bookshelfApi() {
  return {
    name: 'bookshelf-api',
    configureServer(server: { middlewares: { use: (handler: ReturnType<typeof createApiHandler>) => void } }) {
      server.middlewares.use(createApiHandler());
    },
    configurePreviewServer(server: { middlewares: { use: (handler: ReturnType<typeof createApiHandler>) => void } }) {
      server.middlewares.use(createApiHandler());
    },
  };
}

export default defineConfig({
  plugins: [bookshelfApi()],
  server: { port: 5174 },
  preview: { port: 5174 },
});
