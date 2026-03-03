#!/usr/bin/env python3
"""
yt-dlp companion server for Save Research extension.

A lightweight HTTP server that proxies download requests to the yt-dlp CLI
and generates tweet PDFs via weasyprint.
Runs on localhost:11435 (like Ollama's pattern on :11434).

Usage:
    python3 yt-dlp-server.py
    python3 yt-dlp-server.py --port 11435
"""

import base64
import html
import json
import os
import re
import subprocess
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen, Request
from urllib.error import URLError

PORT = 11435
DOWNLOAD_TIMEOUT = 600  # 10 minutes

QUALITY_MAP = {
    '720p': '-f bestvideo[height<=720]+bestaudio/best[height<=720]',
    '1080p': '-f bestvideo[height<=1080]+bestaudio/best[height<=1080]',
    'audio-only': '-f bestaudio --extract-audio --audio-format mp3',
}

ALLOWED_HOSTS = {'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'}


def is_youtube_url(url):
    try:
        parsed = urlparse(url)
        return parsed.hostname in ALLOWED_HOSTS
    except Exception:
        return False


def get_ytdlp_version():
    try:
        result = subprocess.run(
            ['yt-dlp', '--version'],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return None


def get_weasyprint_version():
    try:
        import weasyprint
        return weasyprint.__version__
    except ImportError:
        return None
    except Exception:
        return None


def _esc(text):
    """HTML entity escaping."""
    return html.escape(str(text)) if text else ''


def _fetch_image_as_data_uri(url):
    """Fetch an image URL and return as base64 data URI."""
    try:
        req = Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urlopen(req, timeout=15) as resp:
            data = resp.read()
            content_type = resp.headers.get('Content-Type', 'image/jpeg')
            b64 = base64.b64encode(data).decode('ascii')
            return f'data:{content_type};base64,{b64}'
    except Exception as e:
        print(f'[yt-dlp-server] Failed to fetch image {url[:80]}: {e}')
        return None


class Handler(BaseHTTPRequestHandler):

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def _json_response(self, status, data):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            version = get_ytdlp_version()
            wp_version = get_weasyprint_version()
            self._json_response(200, {
                'ok': True,
                'ytdlp': version is not None,
                'version': version or 'not installed',
                'weasyprint': wp_version is not None,
                'weasyprint_version': wp_version or 'not installed',
            })
        else:
            self._json_response(404, {'error': 'Not found'})

    def do_POST(self):
        if self.path == '/download':
            return self._handle_download()
        elif self.path == '/tweet-pdf':
            return self._handle_tweet_pdf()
        else:
            self._json_response(404, {'error': 'Not found'})

    def _handle_download(self):
        # Read request body
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            self._json_response(400, {'error': 'Empty request body'})
            return

        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self._json_response(400, {'error': 'Invalid JSON'})
            return

        url = body.get('url', '')
        output_dir = body.get('output_dir', '')
        quality = body.get('quality', '720p')

        # Validate URL
        if not url or not is_youtube_url(url):
            self._json_response(400, {'error': 'Invalid or non-YouTube URL'})
            return

        # Build output path inside ~/Downloads/
        downloads = Path.home() / 'Downloads'
        if output_dir:
            # Sanitize: prevent path traversal
            safe_dir = re.sub(r'[^a-zA-Z0-9_\-/]', '_', output_dir).strip('/')
            out_path = downloads / safe_dir
        else:
            out_path = downloads

        out_path.mkdir(parents=True, exist_ok=True)

        # Build yt-dlp command
        fmt_flags = QUALITY_MAP.get(quality, QUALITY_MAP['720p'])
        output_template = str(out_path / '%(title)s.%(ext)s')

        cmd = ['yt-dlp'] + fmt_flags.split() + [
            '--merge-output-format', 'mp4',
            '-o', output_template,
            '--no-playlist',
            '--restrict-filenames',
            url,
        ]

        # For audio-only, don't use --merge-output-format mp4
        if quality == 'audio-only':
            cmd = ['yt-dlp'] + fmt_flags.split() + [
                '-o', output_template,
                '--no-playlist',
                '--restrict-filenames',
                url,
            ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True, text=True,
                timeout=DOWNLOAD_TIMEOUT,
            )

            if result.returncode == 0:
                # Try to extract filename from yt-dlp output
                filename = ''
                for line in result.stdout.splitlines():
                    if 'Destination:' in line or 'has already been downloaded' in line:
                        filename = line.split('/')[-1].strip()
                    if '[Merger]' in line and 'Merging formats into' in line:
                        filename = line.split('"')[-2].split('/')[-1] if '"' in line else ''

                self._json_response(200, {
                    'ok': True,
                    'filename': filename,
                    'output_dir': str(out_path),
                })
            else:
                self._json_response(500, {
                    'ok': False,
                    'error': result.stderr[:500] or 'yt-dlp failed',
                })
        except subprocess.TimeoutExpired:
            self._json_response(504, {'ok': False, 'error': 'Download timed out'})
        except FileNotFoundError:
            self._json_response(500, {'ok': False, 'error': 'yt-dlp not found. Install with: pip install yt-dlp'})
        except Exception as e:
            self._json_response(500, {'ok': False, 'error': str(e)})

    def _handle_tweet_pdf(self):
        # Check weasyprint availability
        wp_version = get_weasyprint_version()
        if not wp_version:
            self._json_response(500, {
                'ok': False,
                'error': 'weasyprint not installed. Install with: pip install weasyprint',
            })
            return

        # Read request body
        length = int(self.headers.get('Content-Length', 0))
        if length == 0:
            self._json_response(400, {'error': 'Empty request body'})
            return

        try:
            body = json.loads(self.rfile.read(length))
        except json.JSONDecodeError:
            self._json_response(400, {'error': 'Invalid JSON'})
            return

        tweets = body.get('tweets', [])
        output_dir = body.get('output_dir', '')
        filename = body.get('filename', 'tweet')
        source_url = body.get('source_url', '')

        if not tweets:
            self._json_response(400, {'error': 'No tweets provided'})
            return

        # Build output path inside ~/Downloads/
        downloads = Path.home() / 'Downloads'
        if output_dir:
            safe_dir = re.sub(r'[^a-zA-Z0-9_\-/]', '_', output_dir).strip('/')
            out_path = downloads / safe_dir
        else:
            out_path = downloads

        out_path.mkdir(parents=True, exist_ok=True)

        # Sanitize filename
        safe_filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', filename)[:200]
        pdf_path = out_path / f'{safe_filename}.pdf'

        try:
            # Build HTML for the tweet(s)
            tweet_html_parts = []
            for i, tweet in enumerate(tweets):
                # Fetch and embed images as data URIs
                media_html = ''
                for media_url in tweet.get('mediaUrls', []):
                    data_uri = _fetch_image_as_data_uri(media_url)
                    if data_uri:
                        media_html += f'<img src="{data_uri}" class="tweet-media">'

                # Metrics for first tweet
                metrics_html = ''
                if i == 0:
                    m = tweet.get('metrics', {})
                    metric_parts = []
                    if m.get('likes'):
                        metric_parts.append(f'{_esc(m["likes"])} Likes')
                    if m.get('reposts'):
                        metric_parts.append(f'{_esc(m["reposts"])} Retweets')
                    if m.get('replies'):
                        metric_parts.append(f'{_esc(m["replies"])} Replies')
                    if m.get('views'):
                        metric_parts.append(f'{_esc(m["views"])} Views')
                    if metric_parts:
                        metrics_html = f'<div class="metrics">{" &middot; ".join(metric_parts)}</div>'

                text_html = _esc(tweet.get('text', '')).replace('\n', '<br>')
                timestamp = tweet.get('timestamp', '')

                tweet_html_parts.append(f'''
                <div class="tweet-card{' first' if i == 0 else ''}">
                    <div class="author-line">
                        <strong>{_esc(tweet.get('authorName', ''))}</strong>
                        <span class="handle">{_esc(tweet.get('authorHandle', ''))}</span>
                        {f'<span class="timestamp">&middot; {_esc(timestamp)}</span>' if timestamp else ''}
                    </div>
                    <div class="tweet-text">{text_html}</div>
                    {media_html}
                    {metrics_html}
                </div>
                ''')

            full_html = f'''<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
    body {{
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        max-width: 600px;
        margin: 40px auto;
        padding: 0 20px;
        color: #0f1419;
        line-height: 1.5;
    }}
    .source-url {{
        font-size: 11px;
        color: #536471;
        margin-bottom: 16px;
        word-break: break-all;
    }}
    .tweet-card {{
        border: 1px solid #cfd9de;
        border-radius: 16px;
        padding: 16px;
        margin-bottom: 12px;
    }}
    .tweet-card.first {{
        border-width: 2px;
    }}
    .author-line {{
        margin-bottom: 8px;
    }}
    .author-line strong {{
        font-size: 15px;
    }}
    .handle {{
        color: #536471;
        font-size: 14px;
        margin-left: 4px;
    }}
    .timestamp {{
        color: #536471;
        font-size: 14px;
        margin-left: 4px;
    }}
    .tweet-text {{
        font-size: 15px;
        margin-bottom: 12px;
        white-space: pre-wrap;
    }}
    .tweet-media {{
        max-width: 100%;
        border-radius: 12px;
        margin-bottom: 12px;
    }}
    .metrics {{
        color: #536471;
        font-size: 13px;
        padding-top: 8px;
        border-top: 1px solid #eff3f4;
    }}
</style>
</head>
<body>
    <div class="source-url">{_esc(source_url)}</div>
    {''.join(tweet_html_parts)}
</body>
</html>'''

            import weasyprint
            weasyprint.HTML(string=full_html).write_pdf(str(pdf_path))

            self._json_response(200, {
                'ok': True,
                'filename': pdf_path.name,
                'output_dir': str(out_path),
            })
        except Exception as e:
            self._json_response(500, {'ok': False, 'error': str(e)})

    def log_message(self, format, *args):
        print(f'[yt-dlp-server] {args[0]}')


def main():
    port = PORT
    if len(sys.argv) > 1 and sys.argv[1] == '--port' and len(sys.argv) > 2:
        port = int(sys.argv[2])

    version = get_ytdlp_version()
    wp_version = get_weasyprint_version()
    print(f'[yt-dlp-server] Starting on http://localhost:{port}')
    print(f'[yt-dlp-server] yt-dlp: {version or "NOT INSTALLED"}')
    if not version:
        print('[yt-dlp-server] Warning: yt-dlp not found. Install with: pip install yt-dlp')
    print(f'[yt-dlp-server] weasyprint: {wp_version or "NOT INSTALLED"}')
    if not wp_version:
        print('[yt-dlp-server] Warning: weasyprint not found. Install with: pip install weasyprint')
    print(f'[yt-dlp-server] Downloads go to: ~/Downloads/<collection>/<media>/')
    print()

    server = HTTPServer(('127.0.0.1', port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n[yt-dlp-server] Shutting down')
        server.server_close()


if __name__ == '__main__':
    main()
