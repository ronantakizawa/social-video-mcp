# yt-player-mcp

MCP server that gives AI agents the ability to play videos from YouTube, TikTok, and Instagram, browse your accounts, and control playback — all through a lightweight [mpv](https://mpv.io/) player window.

Built for [Claude Code](https://claude.ai/claude-code) and any MCP-compatible client.

## Features

**Playback** — Play videos from YouTube, TikTok, or Instagram in a native mpv window with full remote control:
- Play, pause, stop, seek
- Playlist playback with next/prev navigation and shuffle
- Authenticated playback via Chrome cookies (age-restricted, private videos)

**YouTube Account** — Browse your YouTube account directly from your AI agent:
- Subscription feed, liked videos, watch later, history
- List subscribed channels
- Browse channel uploads and Shorts
- Search YouTube with personalized results

**TikTok** — Browse and play TikTok content:
- Fetch videos from any TikTok user profile
- Play a user's videos as a continuous playlist

**Instagram** — Play Instagram content:
- Play individual Reels and post videos
- Fetch post metadata

**Video Info** — Fetch metadata without playing: title, description, chapters, duration, tags, view/like counts.

## Prerequisites

```bash
brew install mpv yt-dlp
```

- **mpv** — Lightweight video player
- **yt-dlp** — Video stream resolver and cookie extractor
- **Google Chrome** — Logged into YouTube/TikTok/Instagram (for authenticated features)
- **Node.js** >= 18

## Installation

```bash
git clone https://github.com/ronantakizawa/yt-player-mcp.git
cd yt-player-mcp
npm install
npm run build
```

## Configuration

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "yt-player": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/yt-player-mcp/dist/index.js"]
    }
  }
}
```

Then restart Claude Code.

## Tools

### Playback

| Tool | Description |
|------|-------------|
| `play_video` | Play a YouTube, TikTok, or Instagram video. Optional `timestamp`. |
| `play_playlist` | Play an entire YouTube playlist. Optional `shuffle`. |
| `pause_video` | Toggle pause/resume. |
| `stop_video` | Stop playback and close the player window. |
| `seek_video` | Seek to an absolute position in seconds. |
| `next_video` | Skip to the next video in a playlist. |
| `prev_video` | Go back to the previous video in a playlist. |
| `get_status` | Get current playback state: title, position, duration, paused. |

### YouTube Account

| Tool | Description |
|------|-------------|
| `get_youtube_feed` | Fetch your subscription feed, liked videos, watch later, or history. |
| `get_subscribed_channels` | List your subscribed YouTube channels. |
| `get_channel_videos` | List recent uploads from a specific channel. |
| `get_channel_shorts` | List recent Shorts from a specific channel. |
| `get_subscription_shorts` | Fetch recent Shorts from your subscribed channels. |
| `play_shorts` | Play Shorts as a continuous auto-advancing playlist. |
| `search_youtube` | Search YouTube with personalized results. |

### TikTok

| Tool | Description |
|------|-------------|
| `get_tiktok_user_videos` | Fetch recent videos from a TikTok user profile. |
| `play_tiktok_user` | Play a TikTok user's videos as a continuous playlist. |

### Instagram

| Tool | Description |
|------|-------------|
| `play_instagram_video` | Play an Instagram Reel or post video. |
| `get_instagram_post_info` | Fetch metadata for an Instagram post or Reel. |

### Metadata

| Tool | Description |
|------|-------------|
| `get_video_info` | Fetch full video metadata from YouTube, TikTok, or Instagram. |

## How It Works

- **Playback**: Spawns `mpv` with `--input-ipc-server` for JSON IPC control over a Unix socket. All playback commands (pause, seek, next/prev) are sent through this socket.
- **Data Fetching**: Calls `yt-dlp` directly with `-J --flat-playlist --cookies-from-browser chrome` to fetch structured JSON from video platforms.
- **Authentication**: Reads cookies from Chrome's local storage via yt-dlp's `--cookies-from-browser` flag. No OAuth setup required — if you're logged into a platform in Chrome, it just works.

## Platform Support

| Feature | YouTube | TikTok | Instagram |
|---------|---------|--------|-----------|
| Play single video | Yes | Yes | Yes |
| User profile feed | Yes | Yes | Broken in yt-dlp |
| Account feeds | Yes (subs, liked, history) | No | No |
| Search | Yes | No | No |
| Shorts/Reels | Yes | N/A | Single URL only |

## Example Usage

```
> Play my subscription feed
> Search YouTube for "rust programming tutorials" and play the first result
> Show me the latest TikToks from @tiktok
> Play this Instagram Reel: https://www.instagram.com/reel/...
> What chapters does this video have? Then skip to chapter 3
```

## License

MIT
