# /// script
# dependencies = [
#   "httpx"
# ]
# ///

import logging
import httpx
import argparse

logger = logging.getLogger(__name__)

def main():
    setup_logging()
    logger.info("Hello from S3 Path Deletion Service!")

    key = "something-secure"
    logger.info("Fetching paths to delete from WEBKNOSSOS at xxx...")
    paths_to_delete = fetch_paths_to_delete(key)
    logger.info(f"WEBKNOSSOS listed {len(paths_to_delete)} paths.")



    deleted_paths = [paths_to_delete[0], paths_to_delete[1]]
    logger.info(f"Marking {len(deleted_paths)} paths as deleted in WEBKNOSSOS...")
    mark_paths_as_deleted(key, deleted_paths)


def fetch_paths_to_delete(key: str):
    wk_uri = "http://localhost:9000"
    api_version = 12
    response = httpx.request(
        "GET",
        f"{wk_uri}/api/v{api_version}/datasets/pathsToDelete",
        params={"key": key},
    )
    response.raise_for_status()
    return response.json()


def mark_paths_as_deleted(key: str, paths: list[str]):
    wk_uri = "http://localhost:9000"
    api_version = 12
    response = httpx.request(
        "POST",
        f"{wk_uri}/api/v{api_version}/datasets/pathsToDelete/markAsDeleted",
        params={"key": key},
        json=paths
    )
    response.raise_for_status()

def setup_logging():
    log_formatter = logging.Formatter(
        f"%(asctime)s %(levelname)-8s %(message)s"
    )
    handler = logging.StreamHandler()
    handler.setFormatter(log_formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

if __name__ == '__main__':
    main()
