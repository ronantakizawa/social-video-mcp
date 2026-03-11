#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as mpv from './mpv.js';
import { fetchFeed, fetchVideoInfo, pickVideoFields } from './ytdlp.js';
import { validateYouTubeUrl, checkDeps, errorResult, textResult, stripChannelSuffix, FEED_URLS } from './validate.js';

const server = new McpServer({ name: 'yt-player-mcp', version: '1.2.0' });

// --- Playback tools ---

server.tool(
  'play_video',
  'Play a YouTube video in a lightweight mpv player window. Optionally start at a specific timestamp.',
  {
    url: z.string().url().describe('YouTube video URL'),
    timestamp: z.number().min(0).optional().describe('Start position in seconds'),
  },
  async ({ url, timestamp }) => {
    const urlErr = validateYouTubeUrl(url);
    if (urlErr) return errorResult(urlErr);
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      await mpv.launch({ url, timestamp });
    } catch {
      return errorResult('mpv failed to start. Run `mpv <url>` manually to see the error.');
    }

    let title = url;
    try { title = (await mpv.getProperty('media-title')) as string || url; } catch { /* loading */ }

    return textResult({ status: 'playing', title, url, ...(timestamp ? { startedAt: `${timestamp}s` } : {}) });
  }
);

server.tool(
  'play_playlist',
  'Play an entire YouTube playlist in mpv. Supports playlist URLs and channel upload pages.',
  {
    url: z.string().url().describe('YouTube playlist or channel URL'),
    shuffle: z.boolean().default(false).describe('Shuffle the playlist'),
  },
  async ({ url, shuffle }) => {
    const urlErr = validateYouTubeUrl(url);
    if (urlErr) return errorResult(urlErr);
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      await mpv.launch({ url, shuffle, socketTimeoutMs: 15_000 });
    } catch {
      return errorResult('mpv failed to start. Run `mpv <url>` manually to see the error.');
    }

    let title = url;
    let tracks: unknown = null;
    try {
      title = (await mpv.getProperty('media-title')) as string || url;
      tracks = await mpv.getProperty('playlist-count');
    } catch { /* loading */ }

    return textResult({ status: 'playing_playlist', title, url, tracks, shuffle });
  }
);

server.tool(
  'stop_video',
  'Stop the currently playing video and close the mpv window.',
  {},
  async () => {
    if (!mpv.isPlaying()) return textResult('No video is currently playing.');
    mpv.cleanup();
    return textResult('Video stopped.');
  }
);

server.tool(
  'pause_video',
  'Toggle pause/resume on the currently playing video.',
  {},
  async () => {
    try {
      await mpv.command(['cycle', 'pause']);
      const paused = await mpv.getProperty('pause');
      return textResult(paused ? 'Video paused.' : 'Video resumed.');
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'seek_video',
  'Seek to an absolute position in the currently playing video.',
  { seconds: z.number().min(0).describe('Position to seek to in seconds') },
  async ({ seconds }) => {
    try {
      await mpv.command(['seek', seconds, 'absolute']);
      return textResult(`Seeked to ${seconds}s.`);
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'next_video',
  'Skip to the next video in the current playlist.',
  {},
  async () => {
    try {
      await mpv.command(['playlist-next']);
      await new Promise((r) => setTimeout(r, 1000));
      const [title, pos, count] = await Promise.all([
        mpv.getProperty('media-title'),
        mpv.getProperty('playlist-pos'),
        mpv.getProperty('playlist-count'),
      ]);
      return textResult({ status: 'skipped_next', title, position: `${Number(pos) + 1}/${count}` });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'prev_video',
  'Go back to the previous video in the current playlist.',
  {},
  async () => {
    try {
      await mpv.command(['playlist-prev']);
      await new Promise((r) => setTimeout(r, 1000));
      const [title, pos, count] = await Promise.all([
        mpv.getProperty('media-title'),
        mpv.getProperty('playlist-pos'),
        mpv.getProperty('playlist-count'),
      ]);
      return textResult({ status: 'skipped_prev', title, position: `${Number(pos) + 1}/${count}` });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'get_status',
  'Get the current playback status: title, position, duration, and pause state.',
  {},
  async () => {
    try {
      const [title, position, duration, paused] = await Promise.all([
        mpv.getProperty('media-title'),
        mpv.getProperty('time-pos'),
        mpv.getProperty('duration'),
        mpv.getProperty('pause'),
      ]);
      return textResult({
        title,
        position: typeof position === 'number' ? `${Math.floor(position)}s` : null,
        duration: typeof duration === 'number' ? `${Math.floor(duration)}s` : null,
        paused,
      });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

// --- YouTube data tools ---

server.tool(
  'get_youtube_feed',
  'Fetch videos from your YouTube account using Chrome cookies. Supports: subscriptions, liked, watch_later, history.',
  {
    feed: z.enum(['subscriptions', 'liked', 'watch_later', 'history']).describe('Which feed to fetch'),
    limit: z.number().min(1).max(50).default(15).describe('Max number of videos to return (default 15)'),
  },
  async ({ feed, limit }) => {
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      const result = await fetchFeed(FEED_URLS[feed], limit);
      const videos = (result.entries || []).map(pickVideoFields);
      return textResult({ feed, count: videos.length, videos });
    } catch (err) {
      return errorResult(`Error fetching ${feed}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'search_youtube',
  'Search YouTube for videos. Uses Chrome cookies for personalized results.',
  {
    query: z.string().describe('Search query'),
    limit: z.number().min(1).max(30).default(10).describe('Max results (default 10)'),
  },
  async ({ query, limit }) => {
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      const result = await fetchFeed(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, limit);
      const videos = (result.entries || []).map(pickVideoFields);
      return textResult({ query, count: videos.length, videos });
    } catch (err) {
      return errorResult(`Error searching: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'get_video_info',
  'Fetch full metadata for a YouTube video without playing it: title, description, chapters, duration, channel, upload date, view count, tags.',
  { url: z.string().url().describe('YouTube video URL') },
  async ({ url }) => {
    const urlErr = validateYouTubeUrl(url);
    if (urlErr) return errorResult(urlErr);
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      const info = await fetchVideoInfo(url);
      const chapters = (info.chapters as Array<Record<string, unknown>> | undefined)?.map((ch) => ({
        title: ch.title, start: ch.start_time, end: ch.end_time,
      })) || [];

      return textResult({
        title: info.title, channel: info.channel, upload_date: info.upload_date,
        duration: info.duration, view_count: info.view_count, like_count: info.like_count,
        description: info.description, tags: info.tags, chapters,
      });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'get_subscribed_channels',
  'List your subscribed YouTube channels using Chrome cookies.',
  { limit: z.number().min(1).max(100).default(30).describe('Max channels to return (default 30)') },
  async ({ limit }) => {
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      const result = await fetchFeed('https://www.youtube.com/feed/channels', limit);
      const channels = (result.entries || []).map((e) => ({
        channel: e.channel, channel_url: e.channel_url || e.url, title: e.title,
      }));
      return textResult({ count: channels.length, channels });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'get_channel_videos',
  'List recent video uploads from a specific YouTube channel.',
  {
    channel_url: z.string().url().describe('YouTube channel URL (e.g. https://www.youtube.com/@ChannelName)'),
    limit: z.number().min(1).max(50).default(15).describe('Max videos to return (default 15)'),
  },
  async ({ channel_url, limit }) => {
    const urlErr = validateYouTubeUrl(channel_url);
    if (urlErr) return errorResult(urlErr);
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    const url = channel_url.endsWith('/videos') ? channel_url : `${channel_url.replace(/\/$/, '')}/videos`;
    try {
      const result = await fetchFeed(url, limit);
      const videos = (result.entries || []).map(pickVideoFields);
      return textResult({ channel: result.title || channel_url, count: videos.length, videos });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

// --- Shorts tools ---

async function fetchShortsFromChannel(channelUrl: string, limit: number) {
  const url = `${stripChannelSuffix(channelUrl)}/shorts`;
  const result = await fetchFeed(url, limit);
  return (result.entries || []).map(pickVideoFields);
}

async function fetchSubscriptionShortUrls(maxChannels: number, perChannel: number): Promise<{ urls: string[]; channelNames: string[] }> {
  const subsResult = await fetchFeed('https://www.youtube.com/feed/channels', maxChannels);
  const channels = (subsResult.entries || []).slice(0, maxChannels);

  const results = await Promise.allSettled(
    channels.map(async (ch) => {
      const chUrl = (ch.channel_url || ch.url) as string;
      if (!chUrl) return [];
      const result = await fetchFeed(`${stripChannelSuffix(chUrl)}/shorts`, perChannel);
      return (result.entries || []).map((e) => ({ url: e.url as string, upload_date: e.upload_date as string }));
    })
  );

  const items: { url: string; upload_date: string }[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
  }
  items.sort((a, b) => (b.upload_date || '').localeCompare(a.upload_date || ''));

  return {
    urls: items.map((i) => i.url).filter(Boolean),
    channelNames: channels.map((ch) => (ch.channel || ch.title) as string),
  };
}

server.tool(
  'get_channel_shorts',
  'List recent Shorts from a specific YouTube channel.',
  {
    channel_url: z.string().url().describe('YouTube channel URL (e.g. https://www.youtube.com/@ChannelName)'),
    limit: z.number().min(1).max(50).default(15).describe('Max shorts to return (default 15)'),
  },
  async ({ channel_url, limit }) => {
    const urlErr = validateYouTubeUrl(channel_url);
    if (urlErr) return errorResult(urlErr);
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      const shorts = await fetchShortsFromChannel(channel_url, limit);
      return textResult({ channel: channel_url, count: shorts.length, shorts });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'get_subscription_shorts',
  'Fetch recent Shorts from your subscribed YouTube channels. Pulls your subscriptions, then grabs the latest Shorts from each.',
  {
    max_channels: z.number().min(1).max(20).default(5).describe('How many subscribed channels to sample (default 5)'),
    shorts_per_channel: z.number().min(1).max(10).default(3).describe('Shorts to fetch per channel (default 3)'),
  },
  async ({ max_channels, shorts_per_channel }) => {
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    try {
      const subsResult = await fetchFeed('https://www.youtube.com/feed/channels', max_channels);
      const channels = (subsResult.entries || []).slice(0, max_channels);
      if (channels.length === 0) return textResult('No subscribed channels found.');

      const results = await Promise.allSettled(
        channels.map(async (ch) => {
          const chUrl = (ch.channel_url || ch.url) as string;
          if (!chUrl) return [];
          const result = await fetchFeed(`${stripChannelSuffix(chUrl)}/shorts`, shorts_per_channel);
          return (result.entries || []).map((e) => ({ ...pickVideoFields(e), channel: (ch.channel || ch.title) as string }));
        })
      );

      const allShorts: Array<Record<string, unknown>> = [];
      for (const r of results) {
        if (r.status === 'fulfilled') allShorts.push(...r.value);
      }
      allShorts.sort((a, b) => String(b.upload_date || '').localeCompare(String(a.upload_date || '')));

      const channelNames = channels.map((ch) => (ch.channel || ch.title) as string);
      return textResult({ channels_sampled: channelNames, count: allShorts.length, shorts: allShorts });
    } catch (err) {
      return errorResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
);

server.tool(
  'play_shorts',
  'Play Shorts as a continuous auto-advancing playlist. Fetch from a specific channel or from your subscribed channels.',
  {
    source: z.enum(['channel', 'subscriptions']).describe('"channel" or "subscriptions"'),
    channel_url: z.string().url().optional().describe('Required when source is "channel". YouTube channel URL.'),
    max_channels: z.number().min(1).max(20).default(5).describe('When source is "subscriptions": channels to sample (default 5)'),
    shorts_per_channel: z.number().min(1).max(10).default(3).describe('When source is "subscriptions": shorts per channel (default 3)'),
    limit: z.number().min(1).max(50).default(15).describe('When source is "channel": max shorts (default 15)'),
    shuffle: z.boolean().default(false).describe('Shuffle the playback order'),
  },
  async ({ source, channel_url, max_channels, shorts_per_channel, limit, shuffle }) => {
    const depErr = checkDeps();
    if (depErr) return errorResult(depErr);

    if (source === 'channel') {
      if (!channel_url) return errorResult('channel_url is required when source is "channel".');
      const urlErr = validateYouTubeUrl(channel_url);
      if (urlErr) return errorResult(urlErr);
    }

    let urls: string[];
    try {
      if (source === 'channel') {
        const result = await fetchFeed(`${stripChannelSuffix(channel_url!)}/shorts`, limit);
        urls = (result.entries || []).map((e) => e.url as string).filter(Boolean);
      } else {
        const sub = await fetchSubscriptionShortUrls(max_channels, shorts_per_channel);
        urls = sub.urls;
      }
    } catch (err) {
      return errorResult(`Error fetching shorts: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (urls.length === 0) return textResult('No shorts found.');

    const playlistFile = mpv.writeTempPlaylist(urls);

    try {
      await mpv.launch({ playlistFile, shuffle, socketTimeoutMs: 15_000 });
    } catch {
      return errorResult('mpv failed to start. Run `mpv <url>` manually to see the error.');
    }

    let title = 'Shorts playlist';
    try { title = (await mpv.getProperty('media-title')) as string || title; } catch { /* loading */ }

    return textResult({ status: 'playing_shorts', title, total: urls.length, shuffle, source });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
