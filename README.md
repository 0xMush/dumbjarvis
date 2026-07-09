# dumb jarvis

A lightweight, self-hosted AI assistant with local system access, voice control, and persistent sessions. Built with Python, FastAPI, and the OpenRouter API.

## Features

- **Chat interface** — Dark-terminal themed web UI with streaming responses, markdown rendering, and session management
- **Voice mode** — Browser-based speech recognition (Web Speech API) for hands-free input, plus text-to-speech for AI responses
- **System access** — Built-in tools let the model read, write, edit, delete files, run commands, and search your filesystem (sandboxed to a configurable workspace)
- **Persistent sessions** — Every conversation is saved automatically. Browse, load, or delete past sessions from the sidebar
- **Tool orchestration** — The model can chain up to 5 tool calls per turn, with collapsible tool-call badges in the UI
- **File upload** — Attach files from the browser; contents are injected into the model's context
- **Log viewer** — Live‑tailing log page at `/logs`
- **Workspace control** — API endpoints to view and change the working directory at runtime

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.10+, FastAPI, Uvicorn |
| AI API | OpenRouter (OpenAI‑compatible) |
| WebSocket | `websockets` (via FastAPI) |
| Frontend | Vanilla JS, CSS, HTML |
| Markdown | `marked.js` (CDN) |
| Speech (input) | Web Speech API (`webkitSpeechRecognition`) |
| Speech (output) | Web Speech API (`speechSynthesis`) |
| Logger | Python `logging` with `RotatingFileHandler` |

## Prerequisites

- Python 3.10 or later
- [An OpenRouter account](https://openrouter.ai) and API key
- A modern browser (Chrome recommended for voice features)

## Setup

### 1. Clone the repository

```bash
git clone <repo-url> dumb-jarvis
cd dumb-jarvis
```

### 2. Create a virtual environment and install dependencies

```bash
python3 -m venv venv
source venv/bin/activate    # Linux/macOS
# venv\Scripts\activate     # Windows
pip install openai fastapi uvicorn websockets python-multipart python-dotenv
```

### 3. Configure environment variables

Copy the template below into a file named `.env` in the project root:

```env
JARVIS_API_KEY=sk-or-v1-your-key-here
JARVIS_MODEL=tencent/hy3:free
JARVIS_HOST=0.0.0.0
JARVIS_PORT=8888
JARVIS_WORKSPACE=/home/youruser
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JARVIS_API_KEY` | **Yes** | — | Your OpenRouter API key |
| `JARVIS_MODEL` | No | *(must be set)* | OpenRouter model slug (e.g. `tencent/hy3:free`, `openai/gpt-4o`) |
| `JARVIS_HOST` | No | `0.0.0.0` | Bind address |
| `JARVIS_PORT` | No | `8888` | HTTP port |
| `JARVIS_WORKSPACE` | No | `$HOME` | Root directory for file operations |

> **Note:** The model and API key are read exclusively from `.env`. There is no UI to change them at runtime.

## Running

```bash
# From the project directory (with venv active)
python -m server
```

Open `http://localhost:8888` in your browser.

## Usage

### Chat

Type a message and press Enter or click **▶**. Responses stream in token‑by‑token. Markdown is rendered in real time.

### Talk Mode

1. Click **🎙 Talk Mode** in the header to enable voice features
2. Click the **🎤 mic button** in the input bar to start listening
3. Speak — interim results appear in the live‑transcript area above the input
4. When you stop speaking, the transcript is sent automatically (if auto‑send is on)
5. The AI response is spoken aloud via TTS
6. Click **⏹** or press **Escape** to stop listening or interrupt speech

Toggle auto‑send in **⚙ Settings**.

### File Upload

Click **📎** to attach a file. Its contents are prepended to your next message as `[Attached file: name.txt]`.

### Sessions

- Sessions are saved automatically after every exchange
- Click a session in the sidebar to reload its history
- **+ New** creates a fresh session
- Sessions are stored as JSON files in the `sessions/` directory

### Logs

Visit `/logs` for a live‑tailing view of today's log file (polls every 3 seconds). Raw text is available at `/logs/raw`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves the web UI |
| `GET` | `/api/sessions` | List all sessions |
| `GET` | `/api/sessions/{id}` | Load a session's full history |
| `POST` | `/api/sessions/new` | Create a new session |
| `DELETE` | `/api/sessions/{id}` | Delete a session |
| `POST` | `/api/upload` | Upload a file (returns text content) |
| `GET` | `/api/workspace` | Get the current workspace path |
| `POST` | `/api/workspace` | Set the workspace path (`{"path": "/new/path"}`) |
| `GET` | `/logs` | Live log viewer (HTML) |
| `GET` | `/logs/raw` | Today's log file as plain text |
| `WS` | `/ws/{session_id}` | Chat WebSocket (streaming) |

## Project Structure

```
├── agent.py        # OpenRouter API calls, tool dispatch loop, streaming
├── config.py       # Environment variable loader
├── logger.py       # Rotating file logger
├── main.py         # CLI entry point
├── server.py       # FastAPI app, routes, WebSocket handler
├── session.py      # Session CRUD (JSON files)
├── tools.py        # File system tool implementations
├── static/
│   ├── index.html  # Single‑page application
│   ├── style.css   # Dark terminal theme
│   └── app.js      # WebSocket client, UI logic, voice
├── sessions/       # Auto‑created session storage
├── logs/           # Auto‑created log files
└── .env            # Environment configuration
```

## System Tools

The model can invoke these tools when it needs to interact with your system:

| Tool | Description |
|------|-------------|
| `read_file` | Read a file's contents |
| `write_file` | Write or create a file |
| `edit_file` | Replace text in an existing file |
| `delete_file` | Delete a file (requires confirmation if enabled) |
| `list_dir` | List directory contents |
| `run_command` | Execute a shell command (30‑second timeout) |
| `search_files` | Recursively search for text in files |

All file paths are resolved relative to the configured `JARVIS_WORKSPACE`. Absolute paths are used as‑is.

## Browser Compatibility

| Feature | Chrome | Firefox | Edge | Safari |
|---------|--------|---------|------|--------|
| Chat UI | ✅ | ✅ | ✅ | ✅ |
| Speech input | ✅ | ⚠️ | ✅ | ⚠️ |
| Speech output | ✅ | ✅ | ✅ | ✅ |

**Speech input requires a browser that supports the Web Speech API** (Chrome is recommended). On Linux, Chrome's speech synthesis backend uses `speech-dispatcher` — install it if TTS is silent:

```bash
sudo apt install speech-dispatcher
```

## License

MIT
