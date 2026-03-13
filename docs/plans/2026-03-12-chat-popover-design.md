# Chat Popover Side Panel — Design Document

**Date:** 2026-03-12
**Status:** Approved

## Overview

Add a right-side chat panel to the Save Research browser extension that lets users ask questions about the current page content using Ollama. Special support for YouTube videos (transcript-based chat). Triggered by a floating action button (FAB) injected into every page.

## Architecture

**Approach:** Chrome Side Panel API + Content Script FAB

- FAB is a content script injected into every page via Shadow DOM
- Chat panel uses Chrome's native Side Panel API (`chrome.sidePanel`)
- Communication flows through background.js as a message relay
- Content extraction via Defuddle (general pages) and existing YouTube transcript logic

### New Files

```
save-research/
├── sidepanel.html          # Side panel UI
├── sidepanel.css           # Side panel styles
├── sidepanel.js            # Chat logic, Ollama calls, rendering
├── chat-fab.js             # Content script — FAB injection
├── chat-content.js         # Content script — Defuddle extraction, selection handling
└── lib/
    └── defuddle.min.js     # Defuddle browser bundle
```

### Manifest Changes

- Add `"sidePanel"` permission
- Register `sidepanel.html` as default side panel
- Add `chat-fab.js` and `chat-content.js` as content scripts on `<all_urls>`
- Add `lib/defuddle.min.js` as web-accessible resource

### Message Flow

```
FAB click → chrome.runtime.sendMessage('toggle-sidepanel')
         → background.js → chrome.sidePanel.open()

Side panel opened → 'extract-page-content' → background.js → chat-content.js
                 → Defuddle/YouTube extraction → returns page data
                 → background.js relays to side panel

User sends message → sidepanel.js builds prompt (page context + last 10 messages)
                   → POST to Ollama /api/chat (stream: true)
                   → Tokens rendered in real-time
```

## FAB (Floating Action Button)

- 48px circular button, bottom-right corner (24px from edges)
- Teal (#0d9488) background, white chat bubble SVG icon
- Shadow DOM isolation (same pattern as progress overlay)
- Toggles between chat icon and X icon based on panel state
- Subtle box-shadow, scale-up on hover
- Selection awareness: listens for `mouseup`, stores selected text, shows "Ask about selection" tooltip

## Content Extraction

### General Pages
- Defuddle browser bundle: `new Defuddle(document).parse()`
- Returns: `{ title, author, content, url, domain, wordCount, type: 'page' }`
- Content truncated to ~100K characters

### YouTube
- Reads `window.ytInitialPlayerResponse` for metadata
- Fetches transcript via caption track URL with timestamps
- Returns: `{ title, channel, description, duration, transcript, url, type: 'youtube' }`

### Twitter/X
- DOM scraping via `_extractTweetsFromDOM()` pattern
- Returns: `{ author, tweets[], url, type: 'twitter' }`

### Selection Override
- Selected text sent alongside full page content
- Side panel uses selection as focused context

## Side Panel UI

**Layout (top to bottom):**
1. Header bar — page title, favicon, close button
2. Context indicator — pill showing loaded content type + word count
3. Quick action chips — `Summarize`, `Key takeaways`, `Bullet points`, `ELI5`
4. Chat messages area — scrollable
5. Input area — text input + send button, pinned to bottom

**Message styling:**
- User: right-aligned, teal background, white text
- AI: left-aligned, light gray background, dark text, markdown rendered
- Streaming: tokens append in real-time

**Selection quote:** Gray quoted block above input with selected text (truncated 200 chars), dismissible with X button.

**Theme:** Teal (#0d9488) accents, system font stack, matches existing extension design.

## Ollama Integration

**Connection:** Reuses `ai.ollamaUrl` and `ai.model` from existing settings.

**System prompt (general page):**
```
You are a helpful assistant analyzing the content of a web page.
Page Title: {title}
URL: {url}
--- PAGE CONTENT ---
{content}
---
Answer concisely. Quote relevant parts. Use markdown formatting.
```

**System prompt (YouTube):**
```
You are a helpful assistant analyzing a YouTube video transcript.
Video: {title}
Channel: {channel}
Duration: {duration}
--- TRANSCRIPT ---
{timestamped transcript}
---
```

**Context strategy:**
- First message: system prompt with full page content + user question
- Subsequent: system prompt + full page content + last 10 messages + new question
- Selection prepended to user message: `[Regarding this excerpt: "{text}"] {question}`

**Streaming:** POST to `/api/chat` with `stream: true`, tokens rendered as they arrive.

**Error handling:**
- Ollama unreachable: inline error with retry button
- Model not found: inline error pointing to settings
- No silent failures

## State Management

- Chat history: in-memory array of `{role, content}` objects in sidepanel.js
- Resets on tab URL change (via `chrome.tabs.onUpdated`)
- Page content cached after first extraction per page load
