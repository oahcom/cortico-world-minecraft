/** [danmaku-inject] 直播弹幕注入口。
 *
 * 为什么不用假玩家小号:小号以玩家身份喊话,发言人会被压成一个叫 Danmaku 的账号,
 * 「这句是谁说的」就丢了。这里直接把观众发言投成 minecraft.danmaku 事件:
 * 每个名字都写在正文里,urgent 保证立刻投递(等价于游戏里被点名)。
 *
 * 一个 HTTP 端口(默认 9883)收 POST /inject {"user":"小鲸鱼","text":"加油"},
 * 攒一小段时间合成一条事件再投——弹幕一条一条投会把她淹掉。
 *
 * 端口只对局域网/本机开放;设了 CORTICO_DANMAKU_KEY 就还要带 x-danmaku-key 头。
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.CORTICO_DANMAKU_PORT || 9883);
const KEY = process.env.CORTICO_DANMAKU_KEY || '';
const FLUSH_MS = Number(process.env.CORTICO_DANMAKU_FLUSH_MS || 12000);
const MAX_LINES = Number(process.env.CORTICO_DANMAKU_MAX_LINES || 6);
const MAX_TEXT = 100;
const MAX_PENDING = 40;
const DEDUPE_MS = 60_000;
const WARN_GAP_MS = 30_000;

type WorldLike = { injectDanmaku?: (text: string) => boolean };
type LoggerLike = {
  info?: (msg: string, data?: unknown) => void;
  warn?: (msg: string, data?: unknown) => void;
};

let resolveWorld: (() => WorldLike | null) | null = null;
let logger: LoggerLike = {};
let started = false;
let attempts = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastWarnAt = 0;
const pending: Array<{ user: string; text: string; at: number }> = [];
const recent = new Map<string, number>();

function note(msg: string): void {
  try {
    logger.info?.(msg);
  } catch {
    /* 记日志失败不该影响注入 */
  }
}

function warn(msg: string, data?: unknown): void {
  try {
    logger.warn?.(msg, data);
  } catch {
    /* 同上 */
  }
}

/** 观众昵称可能带冒号/换行,压成一行,免得把「谁说的」搅乱。 */
function clean(raw: unknown, limit: number): string {
  return String(raw ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, limit);
}

function schedule(ms: number): void {
  if (timer) return;
  timer = setTimeout(flush, ms);
  timer.unref?.();
}

function flush(): void {
  timer = null;
  if (!pending.length) return;
  const world = resolveWorld?.() ?? null;
  if (!world || typeof world.injectDanmaku !== 'function') {
    // 她这会儿没连上(在重连/没进服),攒着没意义,直接丢
    pending.length = 0;
    const now = Date.now();
    if (now - lastWarnAt > WARN_GAP_MS) {
      lastWarnAt = now;
      warn('[danmaku-inject] 世界还没起来,这一批弹幕丢掉');
    }
    return;
  }
  const batch = pending.splice(0, MAX_LINES);
  const lines = batch.map((it) => `[直播弹幕] ${it.user}: ${it.text}`);
  const ok = world.injectDanmaku(lines.join('\n'));
  if (!ok) warn('[danmaku-inject] 投递失败', batch.length);
  if (pending.length) schedule(2000);
}

function enqueue(user: string, text: string): boolean {
  const name = clean(user, 24) || '观众';
  const body = clean(text, MAX_TEXT);
  if (!body) return false;
  const now = Date.now();
  const key = `${name}\u0000${body}`;
  for (const [k, at] of recent) {
    if (now - at > DEDUPE_MS) recent.delete(k);
  }
  if (recent.has(key)) return false;
  recent.set(key, now);
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push({ user: name, text: body, at: now });
  schedule(FLUSH_MS);
  return true;
}

function localOrLan(addr: string | undefined): boolean {
  const a = String(addr ?? '').replace(/^::ffff:/, '');
  if (!a) return false;
  if (a === '127.0.0.1' || a === '::1') return true;
  return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res: import('node:http').ServerResponse, code: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  if (!localOrLan(req.socket.remoteAddress)) {
    json(res, 403, { ok: false, error: '只接受本机或局域网' });
    return;
  }
  if (KEY && req.headers['x-danmaku-key'] !== KEY && url.searchParams.get('key') !== KEY) {
    json(res, 401, { ok: false, error: 'key 不对' });
    return;
  }
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    const world = resolveWorld?.() ?? null;
    json(res, 200, {
      ok: true,
      port: PORT,
      world: Boolean(world && typeof world.injectDanmaku === 'function'),
      pending: pending.length,
      flushMs: FLUSH_MS,
    });
    return;
  }
  if (req.method !== 'POST' || url.pathname !== '/inject') {
    json(res, 404, { ok: false, error: '用法:POST /inject {"user":"昵称","text":"内容"}' });
    return;
  }
  void readBody(req)
    .then((raw) => {
      let data: any;
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        json(res, 400, { ok: false, error: '不是合法 JSON' });
        return;
      }
      const items: Array<{ user?: unknown; text?: unknown }> = Array.isArray(data?.items)
        ? data.items
        : [data];
      let taken = 0;
      for (const it of items.slice(0, 20)) {
        if (it && enqueue(String(it.user ?? ''), String(it.text ?? ''))) taken += 1;
      }
      json(res, 200, { ok: true, queued: taken, pending: pending.length });
    })
    .catch((e: unknown) => json(res, 400, { ok: false, error: String(e) }));
});

server.on('listening', () => {
  attempts = 0;
  note(`[danmaku-inject] 已监听 0.0.0.0:${PORT}(合成窗口 ${FLUSH_MS}ms,单批最多 ${MAX_LINES} 条)`);
});

server.on('error', (e: any) => {
  warn('[danmaku-inject] 端口监听失败', { port: PORT, err: String(e?.code ?? e) });
  // 引擎子进程重启时端口可能被上一个进程占着,退避重试到抢到为止
  if (attempts < 30) {
    attempts += 1;
    const wait = Math.min(15_000, 700 * attempts);
    const t = setTimeout(() => server.listen(PORT, '0.0.0.0'), wait);
    t.unref?.();
  }
});

/** 由引擎子进程在 world 起来后调用一次。getWorld 每次现取,子进程里 mod 可能被换掉。 */
export function startDanmakuInjector(opts: {
  getWorld: () => WorldLike | null;
  log?: LoggerLike;
}): void {
  resolveWorld = opts.getWorld;
  if (opts.log) logger = opts.log;
  if (started) return;
  started = true;
  server.listen(PORT, '0.0.0.0');
}
