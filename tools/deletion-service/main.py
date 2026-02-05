# /// script
# dependencies = [
#   "httpx"
# ]
# ///

import logging
import httpx
import argparse

logger = logging.getLogger(__name__)

WK_API_VERSION = 12


def main():
    setup_logging()
    logger.info("Hello from S3 Path Deletion Service!")

    args = parse_pargs()

    logger.info("Fetching paths to delete from WEBKNOSSOS at xxx...")
    paths_to_delete = fetch_paths_to_delete(args)
    logger.info(f"WEBKNOSSOS listed {len(paths_to_delete)} paths.")



    deleted_paths = [paths_to_delete[0], paths_to_delete[1]]
    logger.info(f"Marking {len(deleted_paths)} paths as deleted in WEBKNOSSOS...")
    mark_paths_as_deleted(args, deleted_paths)

def parse_pargs():
    parser = argparse.ArgumentParser(
        description="Script to delete remote paths listed by WEBKNOSSOS."
    )
    parser.add_argument(
        "--wk_uri", help="URI of the WEBKNOSSOS instance", type=str, default="http://localhost:9000"
    )
    parser.add_argument(
        "--wk_key", help="Secret key configured in WEBKNOSSOS under externalPathDeletionService.key", type=str, default="something-secure"
    )
    parser.add_argument(
        "--access_key_id", help="Access key id to access remote paths.", type=str, required=True
    )
    parser.add_argument(
        "--secret_access_key", help="Secret access key to access remote paths.", type=str, required=True
    )
    return parser.parse_args()


def fetch_paths_to_delete(args):
    response = httpx.request(
        "GET",
        f"{args.wk_uri}/api/v{WK_API_VERSION}/datasets/pathsToDelete",
        params={"key": args.wk_key},
    )
    response.raise_for_status()
    return response.json()

def mark_paths_as_deleted(args, paths: list[str]):
    response = httpx.request(
        "POST",
        f"{args.wk_uri}/api/v{WK_API_VERSION}/datasets/pathsToDelete/markAsDeleted",
        params={"key": args.wk_key},
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
