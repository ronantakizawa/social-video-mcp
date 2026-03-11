import { spawn, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { unlinkSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { BROWSER } from './validate.js';

const SOCKET_PATH = join(tmpdir(), `mpv-mcp-${process.getuid?.() ?? process.pid}-${randomBytes(4).toString('hex')}.sock`);

let mpvProcess: ChildProcess | null = null;

export function cleanup(): void {
  stopAutoRefill();
  if (mpvProcess) {
    try { mpvProcess.kill('SIGTERM'); } catch { /* already dead */ }
    mpvProcess = null;
  }
  try { unlinkSync(SOCKET_PATH); } catch { /* socket didn't exist */ }
}

// Graceful shutdown
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { cleanup(); process.exit(0); });
}

function waitForSocket(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (existsSync(SOCKET_PATH)) resolve();
      else if (Date.now() - start > timeoutMs) reject(new Error('mpv socket did not appear — mpv may have failed to start'));
      else setTimeout(check, 200);
    };
    check();
  });
}

function sendCommand(command: unknown[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    let data = '';

    socket.setTimeout(3000);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ command }) + '\n');
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
      for (const line of data.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if ('error' in parsed) {
            socket.end();
            if (parsed.error !== 'success') reject(new Error(`mpv error: ${parsed.error}`));
            else resolve(parsed);
            return;
          }
        } catch { /* incomplete JSON */ }
      }
    });

    socket.on('timeout', () => { socket.destroy(); reject(new Error('mpv IPC timeout')); });
    socket.on('error', (err) => { reject(new Error(`mpv IPC error: ${err.message}. Is a video playing?`)); });

    socket.on('end', () => {
      if (!data.trim()) { reject(new Error('No response from mpv')); return; }
      const lines = data.split('\n').filter(Boolean);
      try {
        const parsed = JSON.parse(lines[lines.length - 1]);
        if (parsed.error && parsed.error !== 'success') reject(new Error(`mpv error: ${parsed.error}`));
        else resolve(parsed);
      } catch { reject(new Error('Invalid response from mpv')); }
    });
  });
}

export async function getProperty(name: string): Promise<unknown> {
  return (await sendCommand(['get_property', name])).data;
}

export async function command(args: unknown[]): Promise<Record<string, unknown>> {
  return sendCommand(args);
}

export function isPlaying(): boolean {
  return mpvProcess !== null;
}

interface LaunchOptions {
  url?: string;
  playlistFile?: string;
  shuffle?: boolean;
  timestamp?: number;
  socketTimeoutMs?: number;
}

export async function launch(opts: LaunchOptions): Promise<void> {
  cleanup();

  const args = [
    `--input-ipc-server=${SOCKET_PATH}`,
    '--force-window',
    '--no-terminal',
    '--ytdl',
    `--ytdl-raw-options=cookies-from-browser=${BROWSER}`,
    '--prefetch-playlist',
  ];

  if (opts.shuffle) args.push('--shuffle');
  if (opts.timestamp && opts.timestamp > 0) args.push(`--start=${opts.timestamp}`);
  if (opts.playlistFile) args.push(`--playlist=${opts.playlistFile}`);
  if (opts.url) args.push(opts.url);

  mpvProcess = spawn('mpv', args, { detached: true, stdio: 'ignore' });
  mpvProcess.unref();
  mpvProcess.on('exit', () => { mpvProcess = null; });

  await waitForSocket(opts.socketTimeoutMs ?? 10_000);
}

export function writeTempPlaylist(urls: string[]): string {
  const path = join(tmpdir(), `mpv-mcp-shorts-${randomBytes(4).toString('hex')}.txt`);
  writeFileSync(path, urls.join('\n') + '\n');
  return path;
}

export async function appendUrl(url: string): Promise<void> {
  await sendCommand(['loadfile', url, 'append']);
}

// --- Auto-refill monitor ---

type RefillFn = (offset: number, limit: number) => Promise<string[]>;

let refillTimer: ReturnType<typeof setInterval> | null = null;
let refillOffset = 0;
let refillFetching = false;

const REFILL_CHECK_INTERVAL = 5_000;  // check every 5s
const REFILL_THRESHOLD = 3;           // fetch more when <= 3 videos left
const REFILL_BATCH = 15;              // fetch 15 more at a time

export function stopAutoRefill(): void {
  if (refillTimer) { clearInterval(refillTimer); refillTimer = null; }
  refillOffset = 0;
  refillFetching = false;
}

export function startAutoRefill(initialCount: number, fetchMore: RefillFn): void {
  stopAutoRefill();
  refillOffset = initialCount;

  refillTimer = setInterval(async () => {
    if (!mpvProcess || refillFetching) return;

    try {
      const pos = await getProperty('playlist-pos') as number;
      const count = await getProperty('playlist-count') as number;
      const remaining = count - pos - 1;

      if (remaining <= REFILL_THRESHOLD) {
        refillFetching = true;
        try {
          const newUrls = await fetchMore(refillOffset, REFILL_BATCH);
          if (newUrls.length === 0) { stopAutoRefill(); return; }
          for (const url of newUrls) await appendUrl(url);
          refillOffset += newUrls.length;
        } finally {
          refillFetching = false;
        }
      }
    } catch {
      // mpv died or IPC failed — stop monitoring
      stopAutoRefill();
    }
  }, REFILL_CHECK_INTERVAL);
}
