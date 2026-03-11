# social-video-mcp

MCP server that gives AI agents the ability to play videos from YouTube and TikTok, browse your accounts, and control playback — all through a lightweight [mpv](https://mpv.io/) player window.

Built for [Claude Code](https://claude.ai/claude-code) and any MCP-compatible client.


https://github.com/user-attachments/assets/08ddb1b3-ed0f-4de3-b465-c0b58ebfa894


## Features

**Playback** — Play videos from YouTube or TikTok in a native mpv window with full remote control:
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

**Video Info** — Fetch metadata without playing: title, description, chapters, duration, tags, view/like counts.

## Prerequisites

```bash
brew install mpv yt-dlp
```

- **mpv** — Lightweight video player
- **yt-dlp** — Video stream resolver and cookie extractor
- **Google Chrome** — Logged into YouTube/TikTok (for authenticated features)
- **Node.js** >= 18

## Installation

```bash
git clone https://github.com/ronantakizawa/social-video-mcp.git
cd social-video-mcp
npm install
npm run build
```

## Configuration

Add to your Claude Code config (`~/.claude.json`):

```json
{
  "mcpServers": {
    "social-video": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/social-video-mcp/dist/index.js"]
    }
  }
}
```

Then restart Claude Code.

## Tools

### Playback

| Tool | Description |
|------|-------------|
| `play_video` | Play a YouTube or TikTok video. Optional `timestamp`. |
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

### Metadata

| Tool | Description |
|------|-------------|
| `get_video_info` | Fetch full video metadata from YouTube or TikTok. |

## How It Works

- **Playback**: Spawns `mpv` with `--input-ipc-server` for JSON IPC control over a Unix socket. All playback commands (pause, seek, next/prev) are sent through this socket.
- **Data Fetching**: Calls `yt-dlp` directly with `-J --flat-playlist --cookies-from-browser chrome` to fetch structured JSON from video platforms.
- **Authentication**: Reads cookies from Chrome's local storage via yt-dlp's `--cookies-from-browser` flag. No OAuth setup required — if you're logged into a platform in Chrome, it just works.

## Platform Support

| Feature | YouTube | TikTok |
|---------|---------|--------|
| Play single video | Yes | Yes |
| User profile feed | Yes | Yes |
| Account feeds | Yes (subs, liked, history) | No |
| Search | Yes | No |
| Shorts | Yes | N/A |

## Example Usage

```
> Play my subscription feed
> Search YouTube for "rust programming tutorials" and play the first result
> Show me the latest TikToks from @nba
> Play TikTok videos from @khaby.lame
> What chapters does this video have? Then skip to chapter 3
```

## License

MIT
