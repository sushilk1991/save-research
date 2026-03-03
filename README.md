# Save Research

A Chrome extension for saving web content — images, links, pages, selections, YouTube videos, and tweets — as organized Markdown files with optional AI enrichment.

## Features

**One-click saving** via right-click context menu or the popup button:

- **Images** — saves the image file directly
- **Links** — converts the linked page to Markdown (via [markdown.new](https://markdown.new), Jina Reader, or built-in converter)
- **Pages** — converts the current page to Markdown
- **Selections** — saves highlighted text as a blockquote note
- **YouTube videos** — extracts title, channel, description, transcript, and metrics into a rich Markdown note; optionally downloads the video via yt-dlp
- **Tweets / X posts** — scrapes tweet text, thread content, author info, media, and engagement metrics from the DOM into structured Markdown; optionally generates a PDF with embedded images

**AI enrichment** (optional, via local [Ollama](https://ollama.com)):
- Auto-generates tags, summary, and category
- Injected into YAML frontmatter and as a visible summary block

**Collections** — organize saves into named collections, each mapped to a subfolder in `~/Downloads/`.

**Folder organization** — optionally sort saves by content type (`images/`, `pages/`, `media/`, `notes/`, `documents/`).

## Install

1. Clone the repo:
   ```
   git clone https://github.com/sushilk1991/save-research.git
   ```
2. Open `chrome://extensions/` (or your Chromium browser's equivalent)
3. Enable **Developer mode**
4. Click **Load unpacked** and select the cloned folder

Works on Chrome, Brave, Edge, Arc, Opera, and any Chromium-based browser.

## Configuration

Click the extension icon → **Settings**, or go to `chrome://extensions/` → Save Research → Details → Extension options.

### Collections

Create multiple collections (e.g. "Research", "Reading List", "Work") — each saves to its own subfolder.

### Markdown Conversion

Choose how web pages are converted:

| Method | Description |
|--------|-------------|
| markdown.new | Best quality, uses the markdown.new API (default) |
| Jina Reader | Fallback, uses Jina's reader API |
| Built-in | Offline, fastest, basic HTML-to-Markdown conversion |

### AI Enrichment (Ollama)

Requires [Ollama](https://ollama.com) running locally:

```bash
brew install ollama
ollama pull qwen3.5:4b
```

Set the CORS origin so the extension can talk to Ollama:

```bash
launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"
```

Then restart Ollama. Enable AI tagging in the extension settings and test the connection.

### YouTube

YouTube detection is enabled by default. When you save a YouTube URL (via right-click or the popup), the extension extracts:

- Video metadata (title, channel, duration, publish date, view count)
- Full transcript (if available)
- AI-generated tags, summary, key takeaways

To also **download the video file**, enable "Download Video File" in settings and set up the [companion server](#companion-server).

### Twitter / X

Twitter detection is enabled by default. When you save a tweet URL, the extension scrapes the rendered DOM for:

- Tweet text (with emoji and line breaks preserved)
- Thread content (all visible tweets)
- Author info and timestamps
- Media references (images, video thumbnails)
- Engagement metrics (likes, retweets, replies, views)

To also **generate a PDF** with embedded images, enable "Save as PDF" in settings and set up the [companion server](#companion-server).

## Companion Server

The companion server (`yt-dlp-server.py`) runs on `localhost:11435` and handles:

- `/health` — reports yt-dlp and weasyprint availability
- `/download` — downloads YouTube videos via yt-dlp
- `/tweet-pdf` — generates tweet PDFs via weasyprint

Required for: YouTube video downloads and tweet PDF generation. Not needed for basic saving.

### Setup

1. Create a virtual environment and install dependencies:

   ```bash
   cd /path/to/save-research
   python3 -m venv .venv
   .venv/bin/pip install yt-dlp weasyprint
   ```

2. Verify everything installed:

   ```bash
   .venv/bin/yt-dlp --version
   .venv/bin/python3 -c "import weasyprint; print(weasyprint.__version__)"
   ```

### Running manually

```bash
.venv/bin/python3 yt-dlp-server.py
# or specify a port:
.venv/bin/python3 yt-dlp-server.py --port 11435
```

### Auto-start on login (macOS)

Create a LaunchAgent so the companion server starts automatically and restarts if it crashes.

1. Create `~/Library/LaunchAgents/com.save-research.companion-server.plist`:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
       <key>Label</key>
       <string>com.save-research.companion-server</string>

       <key>ProgramArguments</key>
       <array>
           <string>/path/to/save-research/.venv/bin/python3</string>
           <string>/path/to/save-research/yt-dlp-server.py</string>
       </array>

       <key>EnvironmentVariables</key>
       <dict>
           <key>PATH</key>
           <string>/path/to/save-research/.venv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
       </dict>

       <key>WorkingDirectory</key>
       <string>/path/to/save-research</string>

       <key>RunAtLoad</key>
       <true/>

       <key>KeepAlive</key>
       <dict>
           <key>SuccessfulExit</key>
           <false/>
       </dict>

       <key>StandardOutPath</key>
       <string>/tmp/save-research-companion.log</string>
       <key>StandardErrorPath</key>
       <string>/tmp/save-research-companion.log</string>

       <key>ProcessType</key>
       <string>Background</string>
   </dict>
   </plist>
   ```

   Replace `/path/to/save-research` with the actual path to your cloned repo.

2. Load and start it:

   ```bash
   launchctl load ~/Library/LaunchAgents/com.save-research.companion-server.plist
   ```

3. Verify it's running:

   ```bash
   curl localhost:11435/health
   # Should return: {"ok": true, "ytdlp": true, ..., "weasyprint": true, ...}
   ```

**Manage the service:**

```bash
# View logs
tail -f /tmp/save-research-companion.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.save-research.companion-server.plist

# Start
launchctl load ~/Library/LaunchAgents/com.save-research.companion-server.plist

# Check what's on port 11435
lsof -i :11435
```

### Auto-start on login (Linux)

Create a systemd user service at `~/.config/systemd/user/save-research-companion.service`:

```ini
[Unit]
Description=Save Research Companion Server
After=network.target

[Service]
ExecStart=/path/to/save-research/.venv/bin/python3 /path/to/save-research/yt-dlp-server.py
WorkingDirectory=/path/to/save-research
Environment=PATH=/path/to/save-research/.venv/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

Then enable and start:

```bash
systemctl --user daemon-reload
systemctl --user enable save-research-companion
systemctl --user start save-research-companion
systemctl --user status save-research-companion
```

## Example Output

A saved tweet produces Markdown like:

```yaml
---
source: https://x.com/user/status/123456
type: tweet
author: "@user"
author_name: "Display Name"
posted: 2026-03-01T12:00:00Z
saved: 2026-03-03T10:30:00Z
ai_tags: [ai, research, llm]
ai_summary: "Discussion of new model capabilities and benchmarks."
ai_category: news
---
```

A saved YouTube video includes the full transcript with timestamps:

```
## Transcript

[00:00] Welcome to today's video...
[00:15] We'll be covering three main topics...
```

## Project Structure

```
save-research/
├── manifest.json        # Extension manifest (MV3)
├── background.js        # Service worker — all save logic
├── progress.js          # Content script — in-tab progress overlay
├── popup.html/js/css    # Extension popup
├── options.html/js/css  # Settings page
├── yt-dlp-server.py     # Companion server (yt-dlp + weasyprint)
├── .venv/               # Python venv for companion server (not checked in)
├── icons/               # Extension icons
└── scripts/             # Utility scripts (icon generation)
```

## License

MIT
