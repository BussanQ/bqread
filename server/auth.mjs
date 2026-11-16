import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE_NAME = 'bqread-session';

function matches(value, expected) {
  const actual = Buffer.from(value);
  const wanted = Buffer.from(expected);
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

export function createAccessControl(options = {}) {
  const token = options.token ?? (process.env.BQREAD_TOKEN || randomBytes(32).toString('hex'));
  const session = createHmac('sha256', token).update(COOKIE_NAME).digest('hex');
  return {
    token,
    url(address) {
      const url = new URL(address);
      url.searchParams.set('token', token);
      return url.href;
    },
    authorize(request, response) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Referrer-Policy', 'no-referrer');
      const url = new URL(request.url ?? '/', 'http://localhost');
      const supplied = url.searchParams.get('token');
      if (supplied !== null && matches(supplied, token)) {
        response.setHeader('Set-Cookie', `${COOKIE_NAME}=${session}; Path=/; HttpOnly; SameSite=Strict`);
        return true;
      }
      const cookie = (request.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`));
      if (supplied === null && cookie && matches(cookie.slice(COOKIE_NAME.length + 1), session)) return true;
      response.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: '访问 token 无效或缺失，请使用启动时终端显示的完整地址。' }));
      return false;
    },
  };
}
