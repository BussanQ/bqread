import { newId } from '../../server/shared/id.mjs';
import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { openLibrary } from './library';
import type { BookSummary } from '../types';

const connections = new SQLiteConnection(CapacitorSQLite);
async function open() {
  const name = 'modu';
  const consistent = await connections.checkConnectionsConsistency();
  const db = consistent.result && (await connections.isConnection(name, false)).result
    ? await connections.retrieveConnection(name, false)
    : await connections.createConnection(name, false, 'no-encryption', 1, false);
  if (!(await db.isDBOpen()).result) await db.open();
  return openLibrary(db);
}
let ready: ReturnType<typeof open> | undefined;
export function library() {
  return ready ??= open().catch(error => { ready = undefined; throw error; });
}

export async function shareBook(book: BookSummary) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const content = await (await library()).original(book.id);
  const name = (book.title + ' - ' + book.author).replace(/[^\p{L}\p{N} ._-]/gu, '_').slice(0, 60);
  const folder = 'export-' + newId();
  const directory = Directory.Cache;
  const { uri } = await Filesystem.writeFile({ path: folder + '/' + name + '.txt', directory,
    data: content, encoding: Encoding.UTF8, recursive: true });
  try { await Share.share({ files: [uri], title: book.title }); }
  finally { await Filesystem.rmdir({ directory, path: folder, recursive: true }); }
}
