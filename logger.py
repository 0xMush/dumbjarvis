import logging
import datetime
from pathlib import Path
from logging.handlers import RotatingFileHandler


def get_logger(name):
    Path("logs").mkdir(exist_ok=True)
    log_file = f"logs/jarvis_{datetime.date.today()}.log"
    handler = RotatingFileHandler(log_file, maxBytes=5_000_000, backupCount=3)
    handler.setFormatter(logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    ))
    logger = logging.getLogger(name)
    logger.setLevel(logging.DEBUG)
    if not logger.handlers:
        logger.addHandler(handler)
    return logger
