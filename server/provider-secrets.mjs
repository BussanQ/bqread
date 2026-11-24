import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function unavailable(message) {
  return Object.assign(new Error(message), { status: 503 });
}

export async function loadMasterKey(folder, create) {
  const path = join(folder, '.config.key');
  try {
    const key = await readFile(path);
    if (key.length !== 32) throw unavailable('AI 提供商主密钥无效，请恢复与配置配套的 .config.key。');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) throw unavailable('AI 提供商主密钥缺失，请恢复与配置配套的 .config.key。');
  }
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  const temp = path + '.' + randomUUID();
  try {
    await writeFile(temp, key, { flag: 'wx', mode: 0o600 });
    // Publish a complete key without replacing another process's key.
    await link(temp, path);
    return key;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return loadMasterKey(folder, false);
  } finally {
    await rm(temp, { force: true });
  }
}

// bqagent uses SHA-256(master || salt), raw standard Base64 and a trailing GCM tag.
function deriveKey(master, salt) {
  return createHash('sha256').update(master).update(salt).digest();
}

const encode = bytes => bytes.toString('base64').replace(/=+$/, '');

export function encryptKey(value, master) {
  const salt = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(master, salt), nonce);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return { salt: encode(salt), nonce: encode(nonce), ciphertext: encode(encrypted) };
}

export function decryptKey(secret, master) {
  try {
    const salt = Buffer.from(secret.salt, 'base64');
    const nonce = Buffer.from(secret.nonce, 'base64');
    const encrypted = Buffer.from(secret.ciphertext, 'base64');
    if (salt.length !== 32 || nonce.length !== 12 || encrypted.length <= 16 ||
        encode(salt) !== secret.salt || encode(nonce) !== secret.nonce || encode(encrypted) !== secret.ciphertext) {
      throw new Error('Invalid encrypted key');
    }
    const cipher = createDecipheriv('aes-256-gcm', deriveKey(master, salt), nonce);
    cipher.setAuthTag(encrypted.subarray(-16));
    return Buffer.concat([cipher.update(encrypted.subarray(0, -16)), cipher.final()]).toString('utf8');
  } catch {
    throw unavailable('AI 提供商密钥解密失败，请检查 .config.key 或重新填写该连接的 API 密钥。');
  }
}
