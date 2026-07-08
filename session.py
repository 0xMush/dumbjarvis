import json
import os
import datetime
from pathlib import Path
from logger import get_logger

log = get_logger("session")
SESSIONS_DIR = Path("sessions")
SESSIONS_DIR.mkdir(exist_ok=True)


def _session_path(session_id):
    return SESSIONS_DIR / f"{session_id}.json"


def create_session():
    now = datetime.datetime.now()
    session_id = now.strftime("%Y-%m-%d_%H-%M-%S")
    session = {
        "id": session_id,
        "created": now.isoformat(),
        "title": "New Session",
        "messages": [],
    }
    save_session(session)
    log.info(f"Session created: {session_id}")
    return session


def save_session(session):
    path = _session_path(session["id"])
    with open(path, "w") as f:
        json.dump(session, f, indent=2)


def load_session(session_id):
    path = _session_path(session_id)
    if not path.exists():
        return None
    with open(path, "r") as f:
        return json.load(f)


def list_sessions():
    sessions = []
    for f in sorted(SESSIONS_DIR.glob("*.json"), reverse=True):
        try:
            with open(f) as fh:
                data = json.load(fh)
            sessions.append({
                "id": data.get("id", f.stem),
                "title": data.get("title", "Untitled"),
                "created": data.get("created", ""),
                "message_count": len(data.get("messages", [])),
            })
        except (json.JSONDecodeError, OSError) as e:
            log.error(f"Failed to read session {f.name}: {e}")
    return sessions


def delete_session(session_id):
    path = _session_path(session_id)
    if path.exists():
        path.unlink()
        log.info(f"Session deleted: {session_id}")
        return True
    return False


def add_message(session_id, role, content):
    session = load_session(session_id)
    if not session:
        return None
    timestamp = datetime.datetime.now().isoformat()
    session["messages"].append({
        "role": role,
        "content": content,
        "timestamp": timestamp,
    })
    if role == "user" and session["title"] == "New Session":
        session["title"] = content[:60]
    save_session(session)
    return session
