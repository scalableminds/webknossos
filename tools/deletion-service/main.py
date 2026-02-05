# /// script
# dependencies = [
#   "httpx"
# ]
# ///

import logging
import httpx
import argparse
import time
import traceback

logger = logging.getLogger(__name__)

WK_API_VERSION = 12


def main():
    setup_logging()
    logger.info("Hello from S3 Path Deletion Service!")

    args = parse_pargs()

    logger.info(
        f"Polling WEBKNOSSOS at {args.wk_uri} for paths to delete, "
        f"with {args.polling_interval_seconds} seconds interval...\n"
    )

    last_poll_successful = True
    while True:
        try:
            poll_for_work(args)
            if not last_poll_successful:
                logger.info("Last polling was successful again after previous errors")
                last_poll_successful = True
        except Exception as e:
            logger.error(f"Error while polling for paths to delete: {e}")
            logger.error(traceback.format_exc())
            logger.info("Continue polling...")
            last_poll_successful = False
        time.sleep(args.polling_interval_seconds)


def poll_for_work(args):
    paths_to_delete = fetch_paths_to_delete(args)
    if not paths_to_delete:
        return

    logger.debug(f"WEBKNOSSOS listed {len(paths_to_delete)} paths to delete.")

    deleted_paths = [paths_to_delete[0]]
    logger.debug(f"Marking {len(deleted_paths)} paths as deleted in WEBKNOSSOS...")
    mark_paths_as_deleted(args, deleted_paths)

def parse_pargs():
    parser = argparse.ArgumentParser(
        description="Service to delete remote paths listed by WEBKNOSSOS."
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
    parser.add_argument(
        "--polling_interval_seconds", help="Interval to sleep after each polling of WEBKNOSSOS (in seconds)", type=int, default=3
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
