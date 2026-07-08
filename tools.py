import os
import subprocess
import traceback
from pathlib import Path
from logger import get_logger
from config import WORKSPACE_DIR

log = get_logger("tools")


def resolve_path(path):
    p = Path(os.path.expanduser(str(path)))
    if not p.is_absolute():
        p = Path(WORKSPACE_DIR) / p
    return str(p)


def read_file(path=None, **kwargs):
    if not path:
        return "Error: path required"
    try:
        path = resolve_path(path)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except FileNotFoundError:
        return f"Error: file not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error reading {path}: {e}"


def write_file(path=None, content="", **kwargs):
    if not path:
        return "Error: path required"
    try:
        path = resolve_path(path)
        parent = os.path.dirname(path)
        if parent:
            Path(parent).mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(str(content))
        return f"Written {len(str(content))} bytes to {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error writing {path}: {e}"


def edit_file(path=None, old=None, new=None, **kwargs):
    if not path:
        return "Error: path required"
    if old is None:
        return "Error: 'old' string required"
    if new is None:
        return "Error: 'new' string required"
    try:
        path = resolve_path(path)
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
        if old not in content:
            return f"Error: string not found in {path}"
        content = content.replace(old, new)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Edited {path} ({len(old)} bytes replaced)"
    except FileNotFoundError:
        return f"Error: file not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error editing {path}: {e}"


def delete_file(path=None, **kwargs):
    if not path:
        return "Error: path required"
    try:
        path = resolve_path(path)
        os.remove(path)
        return f"Deleted {path}"
    except FileNotFoundError:
        return f"Error: file not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error deleting {path}: {e}"


def list_dir(path=".", **kwargs):
    try:
        path = resolve_path(path)
        entries = os.listdir(path)
        lines = []
        for e in sorted(entries):
            full = os.path.join(path, e)
            suffix = "/" if os.path.isdir(full) else ""
            lines.append(f"{e}{suffix}")
        return "\n".join(lines)
    except FileNotFoundError:
        return f"Error: directory not found: {path}"
    except PermissionError:
        return f"Error: permission denied: {path}"
    except Exception as e:
        return f"Error listing {path}: {e}"


def run_command(cmd=None, **kwargs):
    if not cmd:
        return "Error: cmd required"
    try:
        result = subprocess.run(
            str(cmd), shell=True, capture_output=True, text=True, timeout=30
        )
        output = result.stdout
        if result.stderr:
            output += "\nSTDERR:\n" + result.stderr
        if result.returncode != 0:
            output += f"\n(exit code {result.returncode})"
        return output
    except subprocess.TimeoutExpired:
        return "Error: command timed out after 30s"
    except Exception as e:
        return f"Error running command: {e}"


def search_files(query=None, dir=".", **kwargs):
    if not query:
        return "Error: query required"
    dir = resolve_path(dir)
    matches = []
    try:
        for root, dnames, fnames in os.walk(dir):
            dnames[:] = [d for d in dnames if not d.startswith(".")]
            for fname in fnames:
                if fname.startswith("."):
                    continue
                fpath = os.path.join(root, fname)
                try:
                    with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                        for i, line in enumerate(f, 1):
                            if query in line:
                                matches.append(f"{fpath}:{i}: {line.rstrip()}")
                except Exception:
                    pass
    except Exception as e:
        return f"Error searching: {e}"
    return "\n".join(matches[:100]) if matches else "No matches found."


def list_tools():
    return """
Available tools:
- read_file:     {"path": "..."}
- write_file:    {"path": "...", "content": "..."}
- edit_file:     {"path": "...", "old": "...", "new": "..."}
- delete_file:   {"path": "..."}
- list_dir:      {"path": "..."}
- run_command:   {"cmd": "..."}
- search_files:  {"query": "...", "dir": "."}
"""


TOOL_MAP = {
    "read_file": read_file,
    "write_file": write_file,
    "edit_file": edit_file,
    "delete_file": delete_file,
    "list_dir": list_dir,
    "run_command": run_command,
    "search_files": search_files,
}


def execute_tool(name, args):
    if name not in TOOL_MAP:
        return f"Unknown tool: {name}"
    log.debug(f"Tool call: {name}({args})")
    try:
        result = TOOL_MAP[name](**args)
        log.debug(f"Tool result: {str(result)[:500]}")
        return result
    except Exception as e:
        tb = traceback.format_exc()
        log.error(f"Tool {name} failed: {e}\n{tb}")
        return f"Error executing {name}: {e}"
