import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("JARVIS_API_KEY")
MODEL = os.getenv("JARVIS_MODEL", "openai/gpt-oss-20b:free")
BASE_URL = "https://openrouter.ai/api/v1"
HOST = os.getenv("JARVIS_HOST", "0.0.0.0")
PORT = int(os.getenv("JARVIS_PORT", "8888"))

DEFAULT_SETTINGS = {
    "model": MODEL,
    "confirm_destructive": True,
    "talk_mode_default": False,
}
