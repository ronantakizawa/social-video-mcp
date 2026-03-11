import { execSync } from 'child_process';

const ALLOWED_YOUTUBE_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com',
];

const ALLOWED_HOSTS = [
  ...ALLOWED_YOUTUBE_HOSTS,
  'www.tiktok.com',
  'tiktok.com',
  'vm.tiktok.com',
];

export function validateYouTubeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_YOUTUBE_HOSTS.includes(parsed.hostname)) {
      return `URL must be a YouTube link. Got: ${parsed.hostname}`;
    }
    return null;
  } catch {
    return `Invalid URL: ${url}`;
  }
}

export function validateVideoUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
      return `URL must be a YouTube or TikTok link. Got: ${parsed.hostname}`;
    }
    return null;
  } catch {
    return `Invalid URL: ${url}`;
  }
}

export function validateTikTokUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['www.tiktok.com', 'tiktok.com', 'vm.tiktok.com'].includes(parsed.hostname)) {
      return `URL must be a TikTok link. Got: ${parsed.hostname}`;
    }
    return null;
  } catch {
    return `Invalid URL: ${url}`;
  }
}

function commandExists(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function checkDeps(): string | null {
  if (!commandExists('mpv')) return 'mpv is not installed. Install with: brew install mpv';
  if (!commandExists('yt-dlp')) return 'yt-dlp is not installed. Install with: brew install yt-dlp';
  return null;
}

export function errorResult(msg: string) {
  return { content: [{ type: 'text' as const, text: msg }], isError: true };
}

export function textResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

export function stripChannelSuffix(url: string): string {
  return url.replace(/\/(shorts|videos)?\/?$/, '');
}

const SUPPORTED_BROWSERS = ['chrome', 'firefox', 'brave', 'edge', 'safari', 'opera', 'chromium', 'vivaldi'] as const;
export type BrowserName = typeof SUPPORTED_BROWSERS[number];

let currentBrowser: BrowserName = 'chrome';

export function getBrowser(): BrowserName { return currentBrowser; }

export function setBrowser(name: string): string | null {
  const lower = name.toLowerCase() as BrowserName;
  if (!SUPPORTED_BROWSERS.includes(lower)) {
    return `Unsupported browser: ${name}. Supported: ${SUPPORTED_BROWSERS.join(', ')}`;
  }
  currentBrowser = lower;
  return null;
}

export { SUPPORTED_BROWSERS };

export const FEED_URLS: Record<string, string> = {
  subscriptions: 'https://www.youtube.com/feed/subscriptions',
  liked: 'https://www.youtube.com/playlist?list=LL',
  watch_later: 'https://www.youtube.com/playlist?list=WL',
  history: 'https://www.youtube.com/feed/history',
};
