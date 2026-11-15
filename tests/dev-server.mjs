import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const directory = await mkdtemp(join(tmpdir(), 'bqread-browser-'));
process.env.BQREAD_DATA_DIR = directory;
const server = await createServer({ server: { host: '127.0.0.1', port: 5174, strictPort: true } });
await server.listen();
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
