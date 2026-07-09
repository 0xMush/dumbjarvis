import json
import re
import asyncio
from openai import AsyncOpenAI
from config import API_KEY, BASE_URL, MODEL
from tools import execute_tool
from logger import get_logger
import traceback

log = get_logger("agent")

SYSTEM_PROMPT = """You are dumb jarvis, a personal AI assistant with full local system access. You operate with clarity, precision, and calm confidence. You help the user think, write, code, manage files, and execute tasks. You remember everything within a session and can reference past sessions when asked.

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


def extract_tool_call(text):
    text = text.strip()
    if text.startswith("{") and text.endswith("}"):
        try:
            data = json.loads(text)
            if "tool" in data and "args" in data:
                return data
        except json.JSONDecodeError:
            pass
    idx = text.find('"tool"')
    if idx == -1:
        return None
    start = idx
    while start >= 0 and text[start] != '{':
        start -= 1
    if start < 0:
        return None
    depth = 0
    end = start
    while end < len(text):
        if text[end] == '{':
            depth += 1
        elif text[end] == '}':
            depth -= 1
            if depth == 0:
                break
        end += 1
    if depth != 0:
        return None
    try:
        data = json.loads(text[start:end + 1])
        if "tool" in data and "args" in data:
            return data
    except json.JSONDecodeError:
        pass
    return None


async def process_message_streaming(session, user_message):
    model = MODEL
    client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)

    history = build_history(session)
    history.append({"role": "user", "content": user_message})
    log.info(f"Stream processing for session {session['id']} using model {model}")
    log.debug(f"Messages in history: {len(history)}")

    tool_call_count = 0

    while True:
        stream = None
        try:
            stream = await client.chat.completions.create(
                model=model,
                messages=history,
                stream=True,
                timeout=60,
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
        saw_content = False
        try:
            async for chunk in stream:
                if not chunk.choices:
                    log.debug(f"Skipping chunk with no choices: {chunk}")
                    continue
                delta = chunk.choices[0].delta
                if delta.content:
                    saw_content = True
                    collected.append(delta.content)
                    yield {"type": "chunk", "content": delta.content}
                if hasattr(chunk.choices[0], 'finish_reason') and chunk.choices[0].finish_reason == "error":
                    log.error(f"API returned error finish_reason in stream")
                    yield {"type": "error", "content": "Model returned an error. Check API key or model name."}
                    return
        except Exception as e:
            log.error(f"Stream iteration failed: {e}\n{traceback.format_exc()}")
            yield {"type": "error", "content": f"Stream error: {e}"}
            return

        full_content = "".join(collected).strip()
        log.debug(f"Stream complete — {len(full_content)} chars collected, saw_content={saw_content}")

        if not saw_content or not full_content:
            log.warning("Stream returned empty content, trying non-streaming fallback")
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=history,
                    stream=False,
                    timeout=60,
                    extra_headers={
                        "HTTP-Referer": "http://localhost:8888",
                        "X-Title": "JARVIS",
                    },
                )
                full_content = (response.choices[0].message.content or "").strip()
                log.debug(f"Non-streaming fallback got {len(full_content)} chars: {full_content[:200]}")
                if not full_content:
                    yield {"type": "error", "content": "Model returned empty response. Try a different model or check your API key."}
                    return
            except Exception as e:
                log.error(f"Non-streaming fallback also failed: {e}\n{traceback.format_exc()}")
                yield {"type": "error", "content": f"API error (non-streaming): {e}"}
                return

        call = extract_tool_call(full_content)
        if call:
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

        yield {"type": "text", "content": full_content}
        return
