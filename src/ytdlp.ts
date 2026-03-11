import { spawn } from 'child_process';
import { BROWSER } from './validate.js';

const TIMEOUT_MS = 60_000;

export type YtEntry = Record<string, unknown>;
export type YtFeedResult = { entries: YtEntry[]; title?: string };

function spawnYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      reject(new Error(`yt-dlp timed out after ${TIMEOUT_MS / 1000}s`));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      resolve(stdout);
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn yt-dlp: ${err.message}`));
    });
  });
}

export function fetchFeed(url: string, limit: number): Promise<YtFeedResult> {
  return spawnYtDlp([
    url, '-J', '--flat-playlist',
    '--extractor-args', 'youtubetab:approximate_date',
    '--playlist-end', String(limit),
    '--cookies-from-browser', BROWSER,
  ]).then((out) => JSON.parse(out));
}

export function fetchVideoInfo(url: string): Promise<YtEntry> {
  return spawnYtDlp([
    url, '-J', '--no-playlist',
    '--cookies-from-browser', BROWSER,
  ]).then((out) => JSON.parse(out));
}

export function pickVideoFields(e: YtEntry) {
  return {
    title: e.title,
    url: e.url,
    channel: e.channel,
    duration: e.duration,
    view_count: e.view_count,
    upload_date: e.upload_date,
  };
}
