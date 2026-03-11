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
  'www.instagram.com',
  'instagram.com',
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
      return `URL must be a YouTube, TikTok, or Instagram link. Got: ${parsed.hostname}`;
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

export function validateInstagramUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['www.instagram.com', 'instagram.com'].includes(parsed.hostname)) {
      return `URL must be an Instagram link. Got: ${parsed.hostname}`;
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

export const BROWSER = 'chrome';

export const FEED_URLS: Record<string, string> = {
  subscriptions: 'https://www.youtube.com/feed/subscriptions',
  liked: 'https://www.youtube.com/playlist?list=LL',
  watch_later: 'https://www.youtube.com/playlist?list=WL',
  history: 'https://www.youtube.com/feed/history',
};
