import json
import asyncio
import datetime
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from config import HOST, PORT, DEFAULT_SETTINGS
from logger import get_logger
from agent import process_message_streaming
from session import (
    create_session, load_session, save_session,
    list_sessions, delete_session, add_message
)

log = get_logger("server")

app = FastAPI()

settings = dict(DEFAULT_SETTINGS)

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
async def index():
    index_path = Path("static/index.html")
    return HTMLResponse(index_path.read_text())


@app.get("/api/sessions")
async def api_list_sessions():
    return list_sessions()


@app.get("/api/sessions/{session_id}")
async def api_load_session(session_id: str):
    session = load_session(session_id)
    if not session:
        return {"error": "Session not found"}, 404
    return session


@app.post("/api/sessions/new")
async def api_new_session():
    session = create_session()
    return {"id": session["id"]}


@app.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: str):
    ok = delete_session(session_id)
    return {"ok": ok}


@app.post("/api/upload")
async def api_upload(file: UploadFile = File(...)):
    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("utf-8", errors="replace")
    result = f"[Attached file: {file.filename}]\n{text}"
    return {"content": result, "filename": file.filename}


@app.get("/logs", response_class=HTMLResponse)
async def logs_page():
    return """
<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVIS Logs</title>
<style>
  body{background:#0d0d0d;color:#00ff99;font-family:'Courier New',monospace;padding:20px;margin:0}
  pre{white-space:pre-wrap;word-wrap:break-word;font-size:13px;line-height:1.5}
  h1{font-size:18px;font-weight:400;margin:0 0 10px 0;color:#666}
</style>
</head><body>
<h1>JARVIS Logs — <span id="date"></span></h1>
<pre id="log"></pre>
<script>
const d=new Date();document.getElementById('date').textContent=d.toISOString().slice(0,10);
async function fetchLog(){try{const r=await fetch('/logs/raw');const t=await r.text();document.getElementById('log').textContent=t;window.scrollTo(0,document.body.scrollHeight)}catch(e){}}
fetchLog();setInterval(fetchLog,3000);
</script>
</body></html>
"""


@app.get("/logs/raw", response_class=PlainTextResponse)
async def logs_raw():
    today = datetime.date.today()
    log_file = Path(f"logs/jarvis_{today}.log")
    if log_file.exists():
        return log_file.read_text()
    return "No logs for today."


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    log.info(f"WebSocket connected: session {session_id}")

    session = load_session(session_id)
    if not session:
        session = create_session()
        session_id = session["id"]
        await websocket.send_json({"type": "session_created", "id": session_id})

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type", "")

            if msg_type == "message":
                user_text = msg.get("content", "")
                log.info(f"User message in session {session_id}: {user_text[:100]}")

                session = add_message(session_id, "user", user_text)
                if not session:
                    await websocket.send_json({"type": "error", "content": "Session not found"})
                    continue

                full_response = ""
                tool_results = []

                async for event in process_message_streaming(session, user_text, settings):
                    if event["type"] == "chunk":
                        full_response += event["content"]
                        await websocket.send_json(event)
                    elif event["type"] == "tool_call":
                        tool_results.append(event)
                        await websocket.send_json(event)
                    elif event["type"] == "tool_result":
                        tool_results[-1]["result"] = event["result"]
                        await websocket.send_json(event)
                    elif event["type"] == "text":
                        full_response = event["content"]
                        await websocket.send_json(event)
                    elif event["type"] == "error":
                        await websocket.send_json(event)
                        full_response = event["content"]

                if full_response:
                    session = add_message(session_id, "assistant", full_response)
                    await websocket.send_json({"type": "done", "session_id": session_id})

            elif msg_type == "load":
                session = load_session(session_id)
                if session:
                    await websocket.send_json({"type": "session_data", "session": session})
                else:
                    await websocket.send_json({"type": "error", "content": "Session not found"})

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        log.info(f"WebSocket disconnected: session {session_id}")
    except Exception as e:
        log.error(f"WebSocket error: {e}", exc_info=True)
        try:
            await websocket.send_json({"type": "error", "content": str(e)})
        except Exception:
            pass


def start():
    log.info(f"Starting JARVIS server on {HOST}:{PORT}")
    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    start()
