import os
import subprocess
import traceback
from pathlib import Path
from logger import get_logger

log = get_logger("tools")


def read_file(path):
    path = os.path.expanduser(path)
    with open(path, "r") as f:
        return f.read()


def write_file(path, content):
    path = os.path.expanduser(path)
    parent = os.path.dirname(path)
    if parent:
        Path(parent).mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        f.write(content)
    return f"Written {len(content)} bytes to {path}"


def edit_file(path, old, new):
    path = os.path.expanduser(path)
    with open(path, "r") as f:
        content = f.read()
    if old not in content:
        return f"Error: string not found in {path}"
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    return f"Edited {path} ({len(old)} bytes replaced)"


def delete_file(path):
    path = os.path.expanduser(path)
    os.remove(path)
    return f"Deleted {path}"


def list_dir(path):
    path = os.path.expanduser(path)
    entries = os.listdir(path)
    lines = []
    for e in sorted(entries):
        full = os.path.join(path, e)
        suffix = "/" if os.path.isdir(full) else ""
        lines.append(f"{e}{suffix}")
    return "\n".join(lines)


def run_command(cmd):
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=30)
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


def search_files(query, directory="."):
    directory = os.path.expanduser(directory)
    result = subprocess.run(
        ["grep", "-rn", "--color=never", query, directory],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        return result.stdout
    return "No matches found."


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
