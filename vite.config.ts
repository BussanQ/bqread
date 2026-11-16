import { defineConfig, type PreviewServer, type ViteDevServer } from 'vite';
import { createApiHandler } from './server/api.mjs';
import { createAccessControl } from './server/auth.mjs';

function bookshelfApi() {
  function configure(server: ViteDevServer | PreviewServer) {
    const access = createAccessControl();
    server.middlewares.use((request, response, next) => {
      if (access.authorize(request, response)) next();
    });
    server.middlewares.use(createApiHandler());
    const printUrls = server.printUrls.bind(server);
    server.printUrls = () => {
      printUrls();
      const urls = server.resolvedUrls;
      for (const address of [...(urls?.local ?? []), ...(urls?.network ?? [])]) {
        server.config.logger.info(`  墨读访问地址：${access.url(address)}`);
      }
    };
  }
  return {
    name: 'bookshelf-api',
    configureServer: configure,
    configurePreviewServer: configure,
  };
}

export default defineConfig({
  plugins: [bookshelfApi()],
  server: { port: 5174 },
  preview: { port: 5174 },
});
