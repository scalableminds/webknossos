# /// script
# dependencies = [
#   "httpx",
#   "universal-pathlib ~=0.2.0",
#   "s3fs"
# ]
# [tool.uv]
# override-dependencies = [
#   "s3fs >= 0",
#   "aiobotocore >=2.24.3"  # To use botocore>=1.40.2 to avoid deprecated utcfromtimestamp
# ]
# # We require a custom version of s3fs (provided via our own github repo) which has a version tag that is not compatible with the versions requested by other packages.
# # Therefore, the automatic dependency constraints checker would fail. Here, we avoid this by overwriting the s3fs constraint manually.
# # Basically, we do this by allowing any version of s3fs (>=0). This way, the only available version (provided by our github s3fs repository configured below) is always accepted.
# [tool.uv.sources]
# s3fs = { git = "https://github.com/scalableminds/s3fs", branch = "retries" }
# ///

import logging
import httpx
import argparse
import time
import os
import traceback
from upath import UPath
from urllib.parse import urlparse

logger = logging.getLogger(__name__)

WK_API_VERSION = 12


def main():
    setup_logging()
    logger.info("Hello from S3 Path Deletion Service!")

    args = parse_args()

    check_env_vars_ok()

    logger.info(
        f"Polling WEBKNOSSOS at {args.wk_uri} for paths to delete, "
        f"with {args.polling_interval_seconds} seconds interval ...\n"
    )

    last_poll_successful = True
    while True:
        try:
            poll_for_work(args)
            if not last_poll_successful:
                logger.info("Last polling was successful again after previous errors.")
                last_poll_successful = True
        except Exception as e:
            logger.error(f"Error while polling for paths to delete: {e}")
            logger.error(traceback.format_exc())
            logger.info("Continuing polling ...")
            last_poll_successful = False
        time.sleep(args.polling_interval_seconds)


def poll_for_work(args):
    paths_to_delete = fetch_paths_to_delete(args)
    if not paths_to_delete:
        return

    logger.info(f"Deleting {len(paths_to_delete)} paths as listed by WEBKNOSSOS ...")

    deleted_paths = []
    for path in paths_to_delete:
        try:
            delete_path(path)
            deleted_paths.append(path)
        except Exception:
            logger.exception(f"Could not delete {path}")

    if deleted_paths:
        logger.info(f"Marking {len(deleted_paths)} paths as deleted in WEBKNOSSOS ...")
        mark_paths_as_deleted(args, deleted_paths)
    logger.debug("Continuing polling ...")


def delete_path(path: str):
    # endpoint URL must be parsed from the path string.
    parsed_url = urlparse(path)
    endpoint_url = f"https://{parsed_url.netloc}"
    bucket, key = parsed_url.path.strip("/").split("/", maxsplit=1)
    s3_path = f"{bucket}/{key}"

    config_kwargs = {
        "retries": {
            "max_attempts": 10,
            "mode": "standard",
        }
    }

    upath = UPath(
        s3_path,
        protocol="s3",
        endpoint_url=endpoint_url,
        config_kwargs=config_kwargs,
        retries=10,
    )

    logger.info(f"Deleting {path} ...")
    upath.fs.delete(upath.path, recursive=True)


def parse_args():
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
        "--polling_interval_seconds", help="Interval to sleep after each polling of WEBKNOSSOS (in seconds)", type=int, default=3
    )
    return parser.parse_args()


def fetch_paths_to_delete(args):
    response = httpx.request(
        "GET",
        f"{args.wk_uri}/api/v{WK_API_VERSION}/datasets/pathsToDelete",
        params={"key": args.wk_key},
    )
    assert_good_response(response)
    return response.json()


def assert_good_response(response: httpx.Response) -> None:
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as e:
        logger.error(f"Got http {response.status_code}: {response.text}")
        raise e


def mark_paths_as_deleted(args, paths: list[str]):
    response = httpx.request(
        "POST",
        f"{args.wk_uri}/api/v{WK_API_VERSION}/datasets/pathsToDelete/markAsDeleted",
        params={"key": args.wk_key},
        json=paths
    )
    response.raise_for_status()


def check_env_vars_ok():
    required_env_vars = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]
    for required_env_var in required_env_vars:
        if required_env_var not in os.environ:
            raise KeyError(f"Environment variable {required_env_var} must be set")
        if not os.environ[required_env_var]:
            raise KeyError(f"Environment variable {required_env_var} must be non-empty")


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
