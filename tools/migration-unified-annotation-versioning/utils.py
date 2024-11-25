import logging
import time
from typing import Iterator, Tuple
import sys

logger = logging.getLogger(__name__)


def setup_logging():
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter("%(asctime)s %(levelname)-8s %(message)s")
    handler.setFormatter(formatter)
    root.addHandler(handler)


def log_since(before, label: str) -> None:
    diff = time.time() - before
    logger.info(f"{label} took {diff:.2f} s")


# TODO should we go to limit + 1?
def batch_range(
    limit: int, batch_size: int
) -> Iterator[Tuple[int, int]]:
    full_range = range(limit)

    for i in range(full_range.start, full_range.stop, batch_size):
        yield (i, min(i + batch_size, full_range.stop))

        if i + batch_size >= full_range.stop:
            return
