#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SOCKET_PATH = '/tmp/mpv-mcp-socket';
const BROWSER = 'chrome';

const FEED_URLS: Record<string, string> = {
  subscriptions: 'https://www.youtube.com/feed/subscriptions',
  liked: 'https://www.youtube.com/playlist?list=LL',
  watch_later: 'https://www.youtube.com/playlist?list=WL',
  history: 'https://www.youtube.com/feed/history',
};

let mpvProcess: ChildProcess | null = null;

function mpvExists(): boolean {
  try {
    execSync('which mpv', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function killExisting(): void {
  if (mpvProcess) {
    try {
      mpvProcess.kill('SIGTERM');
    } catch {
      // already dead
    }
    mpvProcess = null;
  }
  try {
    unlinkSync(SOCKET_PATH);
  } catch {
    // socket didn't exist
  }
}

function sendMpvCommand(command: unknown[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(SOCKET_PATH);
    let data = '';

    socket.setTimeout(3000);

    socket.on('connect', () => {
      socket.write(JSON.stringify({ command }) + '\n');
    });

    socket.on('data', (chunk) => {
      data += chunk.toString();
      const lines = data.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if ('error' in parsed) {
            socket.end();
            resolve(parsed);
            return;
          }
        } catch {
          // incomplete JSON, keep reading
        }
      }
    });

    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('mpv IPC timeout'));
    });

    socket.on('error', (err) => {
      reject(new Error(`mpv IPC error: ${err.message}. Is a video playing?`));
    });

    socket.on('end', () => {
      if (!data.trim()) {
        reject(new Error('No response from mpv'));
        return;
      }
      try {
        resolve(JSON.parse(data.split('\n').filter(Boolean).pop()!));
      } catch {
        reject(new Error('Invalid response from mpv'));
      }
    });
  });
}

async function getMpvProperty(name: string): Promise<unknown> {
  const result = await sendMpvCommand(['get_property', name]);
  return result.data;
}

function fetchYtFeed(url: string, limit: number): Promise<{ entries: Array<Record<string, unknown>>; title?: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      url, '-J', '--flat-playlist',
      '--extractor-args', 'youtubetab:approximate_date',
      '--playlist-end', String(limit),
      '--cookies-from-browser', BROWSER,
    ];

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });
  });
}

function fetchVideoInfo(url: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const args = [
      url, '-J', '--no-playlist',
      '--cookies-from-browser', BROWSER,
    ];

    const proc = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error('Failed to parse yt-dlp output'));
      }
    });
  });
}

const server = new McpServer({
  name: 'yt-player-mcp',
  version: '1.0.0',
});

// === Tool: play_video ===
server.tool(
  'play_video',
  'Play a YouTube video in a lightweight mpv player window. Optionally start at a specific timestamp.',
  {
    url: z.string().url().describe('YouTube video URL'),
    timestamp: z.number().min(0).optional().describe('Start position in seconds'),
  },
  async ({ url, timestamp }) => {
    if (!mpvExists()) {
      return {
        content: [{ type: 'text' as const, text: 'Error: mpv is not installed. Install with: brew install mpv' }],
        isError: true,
      };
    }

    killExisting();

    const args = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--force-window',
      '--no-terminal',
      '--ytdl',
      `--ytdl-raw-options=cookies-from-browser=${BROWSER}`,
    ];

    if (timestamp && timestamp > 0) {
      args.push(`--start=${timestamp}`);
    }

    args.push(url);

    mpvProcess = spawn('mpv', args, {
      detached: true,
      stdio: 'ignore',
    });

    mpvProcess.unref();

    mpvProcess.on('exit', () => {
      mpvProcess = null;
    });

    // Give mpv a moment to start and create the socket
    await new Promise((r) => setTimeout(r, 2000));

    let title = url;
    try {
      title = (await getMpvProperty('media-title')) as string || url;
    } catch {
      // mpv may still be loading
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'playing',
          title,
          url,
          ...(timestamp ? { startedAt: `${timestamp}s` } : {}),
        }, null, 2),
      }],
    };
  }
);

// === Tool: stop_video ===
server.tool(
  'stop_video',
  'Stop the currently playing video and close the mpv window.',
  {},
  async () => {
    if (!mpvProcess) {
      return {
        content: [{ type: 'text' as const, text: 'No video is currently playing.' }],
      };
    }

    killExisting();

    return {
      content: [{ type: 'text' as const, text: 'Video stopped.' }],
    };
  }
);

// === Tool: pause_video ===
server.tool(
  'pause_video',
  'Toggle pause/resume on the currently playing video.',
  {},
  async () => {
    try {
      await sendMpvCommand(['cycle', 'pause']);
      const paused = await getMpvProperty('pause');
      return {
        content: [{
          type: 'text' as const,
          text: paused ? 'Video paused.' : 'Video resumed.',
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: seek_video ===
server.tool(
  'seek_video',
  'Seek to an absolute position in the currently playing video.',
  {
    seconds: z.number().min(0).describe('Position to seek to in seconds'),
  },
  async ({ seconds }) => {
    try {
      await sendMpvCommand(['seek', seconds, 'absolute']);
      return {
        content: [{
          type: 'text' as const,
          text: `Seeked to ${seconds}s.`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_status ===
server.tool(
  'get_status',
  'Get the current playback status: title, position, duration, and pause state.',
  {},
  async () => {
    try {
      const [title, position, duration, paused] = await Promise.all([
        getMpvProperty('media-title'),
        getMpvProperty('time-pos'),
        getMpvProperty('duration'),
        getMpvProperty('pause'),
      ]);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            title,
            position: typeof position === 'number' ? `${Math.floor(position)}s` : null,
            duration: typeof duration === 'number' ? `${Math.floor(duration)}s` : null,
            paused,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_youtube_feed ===
server.tool(
  'get_youtube_feed',
  'Fetch videos from your YouTube account using Chrome cookies. Supports: subscriptions, liked, watch_later, history, trending.',
  {
    feed: z.enum(['subscriptions', 'liked', 'watch_later', 'history']).describe('Which feed to fetch'),
    limit: z.number().min(1).max(50).default(15).describe('Max number of videos to return (default 15)'),
  },
  async ({ feed, limit }) => {
    const url = FEED_URLS[feed];

    try {
      const result = await fetchYtFeed(url, limit);
      const entries = (result.entries || []).map((e: Record<string, unknown>) => ({
        title: e.title,
        url: e.url,
        channel: e.channel,
        duration: e.duration,
        view_count: e.view_count,
        upload_date: e.upload_date,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ feed, count: entries.length, videos: entries }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error fetching ${feed}: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: search_youtube ===
server.tool(
  'search_youtube',
  'Search YouTube for videos. Uses Chrome cookies for personalized results.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().min(1).max(30).default(10).describe('Max results (default 10)'),
  },
  async ({ query, limit }) => {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    try {
      const result = await fetchYtFeed(url, limit);
      const entries = (result.entries || []).map((e: Record<string, unknown>) => ({
        title: e.title,
        url: e.url,
        channel: e.channel,
        duration: e.duration,
        view_count: e.view_count,
        upload_date: e.upload_date,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ query, count: entries.length, videos: entries }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: play_playlist ===
server.tool(
  'play_playlist',
  'Play an entire YouTube playlist in mpv. Supports playlist URLs and channel upload pages.',
  {
    url: z.string().url().describe('YouTube playlist or channel URL'),
    shuffle: z.boolean().default(false).describe('Shuffle the playlist'),
  },
  async ({ url, shuffle }) => {
    if (!mpvExists()) {
      return {
        content: [{ type: 'text' as const, text: 'Error: mpv is not installed. Install with: brew install mpv' }],
        isError: true,
      };
    }

    killExisting();

    const args = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--force-window',
      '--no-terminal',
      '--ytdl',
      `--ytdl-raw-options=cookies-from-browser=${BROWSER}`,
    ];

    if (shuffle) {
      args.push('--shuffle');
    }

    args.push(url);

    mpvProcess = spawn('mpv', args, {
      detached: true,
      stdio: 'ignore',
    });

    mpvProcess.unref();
    mpvProcess.on('exit', () => { mpvProcess = null; });

    await new Promise((r) => setTimeout(r, 3000));

    let title = url;
    let playlistCount: unknown = null;
    try {
      title = (await getMpvProperty('media-title')) as string || url;
      playlistCount = await getMpvProperty('playlist-count');
    } catch {
      // still loading
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'playing_playlist',
          title,
          url,
          tracks: playlistCount,
          shuffle,
        }, null, 2),
      }],
    };
  }
);

// === Tool: next_video ===
server.tool(
  'next_video',
  'Skip to the next video in the current playlist.',
  {},
  async () => {
    try {
      await sendMpvCommand(['playlist-next']);
      await new Promise((r) => setTimeout(r, 1000));
      const title = await getMpvProperty('media-title');
      const pos = await getMpvProperty('playlist-pos');
      const count = await getMpvProperty('playlist-count');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status: 'skipped_next', title, position: `${Number(pos) + 1}/${count}` }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: prev_video ===
server.tool(
  'prev_video',
  'Go back to the previous video in the current playlist.',
  {},
  async () => {
    try {
      await sendMpvCommand(['playlist-prev']);
      await new Promise((r) => setTimeout(r, 1000));
      const title = await getMpvProperty('media-title');
      const pos = await getMpvProperty('playlist-pos');
      const count = await getMpvProperty('playlist-count');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status: 'skipped_prev', title, position: `${Number(pos) + 1}/${count}` }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_video_info ===
server.tool(
  'get_video_info',
  'Fetch full metadata for a YouTube video without playing it: title, description, chapters, duration, channel, upload date, view count, tags.',
  {
    url: z.string().url().describe('YouTube video URL'),
  },
  async ({ url }) => {
    try {
      const info = await fetchVideoInfo(url);
      const chapters = (info.chapters as Array<Record<string, unknown>> | undefined)?.map((ch) => ({
        title: ch.title,
        start: ch.start_time,
        end: ch.end_time,
      })) || [];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            title: info.title,
            channel: info.channel,
            upload_date: info.upload_date,
            duration: info.duration,
            view_count: info.view_count,
            like_count: info.like_count,
            description: info.description,
            tags: info.tags,
            chapters,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_subscribed_channels ===
server.tool(
  'get_subscribed_channels',
  'List your subscribed YouTube channels using Chrome cookies.',
  {
    limit: z.number().min(1).max(100).default(30).describe('Max channels to return (default 30)'),
  },
  async ({ limit }) => {
    try {
      const result = await fetchYtFeed('https://www.youtube.com/feed/channels', limit);
      const channels = (result.entries || []).map((e: Record<string, unknown>) => ({
        channel: e.channel,
        channel_url: e.channel_url || e.url,
        title: e.title,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ count: channels.length, channels }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_channel_videos ===
server.tool(
  'get_channel_videos',
  'List recent video uploads from a specific YouTube channel.',
  {
    channel_url: z.string().url().describe('YouTube channel URL (e.g. https://www.youtube.com/@ChannelName)'),
    limit: z.number().min(1).max(50).default(15).describe('Max videos to return (default 15)'),
  },
  async ({ channel_url, limit }) => {
    const url = channel_url.endsWith('/videos') ? channel_url : `${channel_url.replace(/\/$/, '')}/videos`;

    try {
      const result = await fetchYtFeed(url, limit);
      const entries = (result.entries || []).map((e: Record<string, unknown>) => ({
        title: e.title,
        url: e.url,
        duration: e.duration,
        view_count: e.view_count,
        upload_date: e.upload_date,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ channel: result.title || channel_url, count: entries.length, videos: entries }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_channel_shorts ===
server.tool(
  'get_channel_shorts',
  'List recent Shorts from a specific YouTube channel.',
  {
    channel_url: z.string().url().describe('YouTube channel URL (e.g. https://www.youtube.com/@ChannelName)'),
    limit: z.number().min(1).max(50).default(15).describe('Max shorts to return (default 15)'),
  },
  async ({ channel_url, limit }) => {
    const base = channel_url.replace(/\/(shorts|videos)?\/?$/, '');
    const url = `${base}/shorts`;

    try {
      const result = await fetchYtFeed(url, limit);
      const entries = (result.entries || []).map((e: Record<string, unknown>) => ({
        title: e.title,
        url: e.url,
        duration: e.duration,
        view_count: e.view_count,
        upload_date: e.upload_date,
      }));

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ channel: result.title || channel_url, count: entries.length, shorts: entries }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: get_subscription_shorts ===
server.tool(
  'get_subscription_shorts',
  'Fetch recent Shorts from your subscribed YouTube channels. Pulls your subscriptions, then grabs the latest Shorts from each. This can take a while depending on how many channels are sampled.',
  {
    max_channels: z.number().min(1).max(20).default(5).describe('How many subscribed channels to sample (default 5)'),
    shorts_per_channel: z.number().min(1).max(10).default(3).describe('Shorts to fetch per channel (default 3)'),
  },
  async ({ max_channels, shorts_per_channel }) => {
    try {
      // Step 1: Fetch subscribed channels
      const subsResult = await fetchYtFeed('https://www.youtube.com/feed/channels', max_channels);
      const channels = (subsResult.entries || []).slice(0, max_channels);

      if (channels.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No subscribed channels found.' }],
        };
      }

      // Step 2: Fetch shorts from each channel in parallel
      const results = await Promise.allSettled(
        channels.map(async (ch: Record<string, unknown>) => {
          const channelUrl = (ch.channel_url || ch.url) as string;
          if (!channelUrl) return [];
          const base = channelUrl.replace(/\/(shorts|videos)?\/?$/, '');
          const shortsResult = await fetchYtFeed(`${base}/shorts`, shorts_per_channel);
          return (shortsResult.entries || []).map((e: Record<string, unknown>) => ({
            title: e.title,
            url: e.url,
            channel: ch.channel || ch.title,
            duration: e.duration,
            view_count: e.view_count,
            upload_date: e.upload_date,
          }));
        })
      );

      const allShorts: Array<Record<string, unknown>> = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          allShorts.push(...r.value);
        }
      }

      // Sort by upload date descending (newest first)
      allShorts.sort((a, b) => {
        const da = String(a.upload_date || '');
        const db = String(b.upload_date || '');
        return db.localeCompare(da);
      });

      const channelsSampled = channels.map((ch: Record<string, unknown>) => ch.channel || ch.title);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            channels_sampled: channelsSampled,
            count: allShorts.length,
            shorts: allShorts,
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  }
);

// === Tool: play_shorts ===
server.tool(
  'play_shorts',
  'Play Shorts as a continuous auto-advancing playlist. Fetch from a specific channel or from your subscribed channels. Each Short auto-advances to the next when done.',
  {
    source: z.enum(['channel', 'subscriptions']).describe('"channel" to play from a specific channel, "subscriptions" to sample from your subscribed channels'),
    channel_url: z.string().url().optional().describe('Required when source is "channel". YouTube channel URL.'),
    max_channels: z.number().min(1).max(20).default(5).describe('When source is "subscriptions": how many channels to sample (default 5)'),
    shorts_per_channel: z.number().min(1).max(10).default(3).describe('When source is "subscriptions": shorts per channel (default 3)'),
    limit: z.number().min(1).max(50).default(15).describe('When source is "channel": max shorts to fetch (default 15)'),
    shuffle: z.boolean().default(false).describe('Shuffle the playback order'),
  },
  async ({ source, channel_url, max_channels, shorts_per_channel, limit, shuffle }) => {
    if (!mpvExists()) {
      return {
        content: [{ type: 'text' as const, text: 'Error: mpv is not installed. Install with: brew install mpv' }],
        isError: true,
      };
    }

    if (source === 'channel' && !channel_url) {
      return {
        content: [{ type: 'text' as const, text: 'Error: channel_url is required when source is "channel".' }],
        isError: true,
      };
    }

    let urls: string[] = [];

    try {
      if (source === 'channel') {
        const base = channel_url!.replace(/\/(shorts|videos)?\/?$/, '');
        const result = await fetchYtFeed(`${base}/shorts`, limit);
        urls = (result.entries || []).map((e: Record<string, unknown>) => e.url as string).filter(Boolean);
      } else {
        // Fetch subscribed channels, then shorts from each
        const subsResult = await fetchYtFeed('https://www.youtube.com/feed/channels', max_channels);
        const channels = (subsResult.entries || []).slice(0, max_channels);

        const results = await Promise.allSettled(
          channels.map(async (ch: Record<string, unknown>) => {
            const chUrl = (ch.channel_url || ch.url) as string;
            if (!chUrl) return [];
            const base = chUrl.replace(/\/(shorts|videos)?\/?$/, '');
            const shortsResult = await fetchYtFeed(`${base}/shorts`, shorts_per_channel);
            return (shortsResult.entries || []).map((e: Record<string, unknown>) => e.url as string).filter(Boolean);
          })
        );

        for (const r of results) {
          if (r.status === 'fulfilled') {
            urls.push(...r.value);
          }
        }
      }
    } catch (err) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error fetching shorts: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }

    if (urls.length === 0) {
      return {
        content: [{ type: 'text' as const, text: 'No shorts found.' }],
      };
    }

    // Write URLs to a temp playlist file
    const playlistPath = join(tmpdir(), 'mpv-mcp-shorts.txt');
    writeFileSync(playlistPath, urls.join('\n') + '\n');

    killExisting();

    const args = [
      `--input-ipc-server=${SOCKET_PATH}`,
      '--force-window',
      '--no-terminal',
      '--ytdl',
      `--ytdl-raw-options=cookies-from-browser=${BROWSER}`,
      `--playlist=${playlistPath}`,
    ];

    if (shuffle) {
      args.push('--shuffle');
    }

    mpvProcess = spawn('mpv', args, {
      detached: true,
      stdio: 'ignore',
    });

    mpvProcess.unref();
    mpvProcess.on('exit', () => { mpvProcess = null; });

    await new Promise((r) => setTimeout(r, 3000));

    let title = 'Shorts playlist';
    try {
      title = (await getMpvProperty('media-title')) as string || title;
    } catch {
      // still loading
    }

    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          status: 'playing_shorts',
          title,
          total: urls.length,
          shuffle,
          source,
        }, null, 2),
      }],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
