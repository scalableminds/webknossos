import logging
import time
from typing import Iterator, Tuple, List
import sys
from math import floor, ceil
from datetime import datetime
from pathlib import Path

logger = logging.getLogger("migration-logs")


def setup_logging():
    logger.setLevel(logging.INFO)

    formatter = logging.Formatter("%(asctime)s %(levelname)-8s %(threadName)-24s %(message)s")

    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.INFO)
    stdout_handler.setFormatter(formatter)
    logger.addHandler(stdout_handler)

    logs_path = Path("logs")
    logs_path.mkdir(exist_ok=True)
    file_handler = logging.FileHandler(f"{logs_path}/{time_str()}.log")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)


def set_log_level_debug():
    logger.setLevel(logging.DEBUG)
    for handler in logger.handlers:
        handler.setLevel(logging.DEBUG)


def time_str() -> str:
    return datetime.now().strftime("%Y-%m-%d_%H-%M-%S.%f")


def log_since(before, label: str, postfix: str = "") -> None:
    diff = time.time() - before
    logger.info(f"{label} took {format_duration(diff)}{postfix}")


def batch_range(
    limit: int, batch_size: int
) -> Iterator[Tuple[int, int]]:
    full_range = range(limit)

    for i in range(full_range.start, full_range.stop, batch_size):
        yield i, min(i + batch_size, full_range.stop)

        if i + batch_size >= full_range.stop:
            return


def batch_list(lst: List, batch_size: int) -> Iterator[List]:
    for start, end in batch_range(len(lst), batch_size):
        yield lst[start:end]


def format_duration(seconds: float) -> str:
    def pluralize(string: str, amount: int) -> str:
        return string if amount == 1 else string + "s"

    max_elements = 3

    label_elements = []

    days = floor(seconds / 3600 / 24)
    if days > 0 and len(label_elements) < max_elements:
        label_elements.append(pluralize(f"{days} day", days))
        seconds -= days * 24 * 3600

    hours = floor(seconds / 3600)
    if hours > 0 and len(label_elements) < max_elements:
        label_elements.append(f"{hours}h")
        seconds -= hours * 3600

    minutes = floor(seconds / 60)
    if minutes > 0 and len(label_elements) < max_elements:
        label_elements.append(f"{minutes}m")
        seconds -= minutes * 60

    whole_seconds = ceil(seconds)
    if seconds >= 0 and len(label_elements) < max_elements:
        if len(label_elements) < 1:
            label_elements.append(f"{seconds:.2f}s")
        else:
            label_elements.append(f"{whole_seconds}s")

    return " ".join(label_elements)
