import json
import asyncio
from openai import AsyncOpenAI
from config import API_KEY, BASE_URL, MODEL
from tools import execute_tool
from logger import get_logger
import traceback

log = get_logger("agent")

SYSTEM_PROMPT = """You are JARVIS, a personal AI assistant with full local system access. You operate with clarity, precision, and calm confidence. You help the user think, write, code, manage files, and execute tasks. You remember everything within a session and can reference past sessions when asked.

You have access to the following tools. When you need to use one, respond ONLY with a JSON block in this exact format and nothing else:

{"tool": "tool_name", "args": {...}}

Available tools:
- read_file:     {"path": "..."}
- write_file:    {"path": "...", "content": "..."}
- edit_file:     {"path": "...", "old": "...", "new": "..."}
- delete_file:   {"path": "..."}
- list_dir:      {"path": "..."}
- run_command:   {"cmd": "..."}
- search_files:  {"query": "...", "dir": "."}

If no tool is needed, respond naturally in plain text. Never wrap normal replies in JSON.
Before any destructive operation (delete_file, overwrite), state what you are about to do and wait for confirmation."""

MAX_TOOL_CALLS = 5


def build_history(session):
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for msg in session.get("messages", []):
        messages.append({"role": msg["role"], "content": msg["content"]})
    return messages


async def process_message_streaming(session, user_message, settings_override=None):
    model = (settings_override or {}).get("model", MODEL)
    client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)

    history = build_history(session)
    history.append({"role": "user", "content": user_message})
    log.info(f"Stream processing for session {session['id']}")
    log.debug(f"Messages in history: {len(history)}")

    tool_call_count = 0

    while True:
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=history,
                stream=True,
                extra_headers={
                    "HTTP-Referer": "http://localhost:8888",
                    "X-Title": "JARVIS",
                },
            )
        except Exception as e:
            log.error(f"Streaming API call failed: {e}\n{traceback.format_exc()}")
            yield {"type": "error", "content": f"API error: {e}"}
            return

        collected = []
        async for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                collected.append(delta.content)
                yield {"type": "chunk", "content": delta.content}

        full_content = "".join(collected).strip()
        log.debug(f"Stream complete ({len(full_content)} chars)")

        if not full_content:
            yield {"type": "error", "content": "Empty response from model"}
            return

        if full_content.startswith("{") and full_content.endswith("}"):
            try:
                call = json.loads(full_content)
                if "tool" in call and "args" in call:
                    if tool_call_count >= MAX_TOOL_CALLS:
                        yield {"type": "error", "content": "Max tool calls reached"}
                        return
                    tool_call_count += 1
                    yield {"type": "tool_call", "tool": call["tool"], "args": call["args"]}
                    result = await asyncio.to_thread(execute_tool, call["tool"], call["args"])
                    yield {"type": "tool_result", "tool": call["tool"], "result": result}
                    history.append({"role": "assistant", "content": full_content})
                    history.append({"role": "system", "content": f"Tool result:\n{result}"})
                    continue
            except json.JSONDecodeError:
                pass

        yield {"type": "text", "content": full_content}
        return
