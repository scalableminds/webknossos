#!/usr/bin/env python3

import logging
import argparse

from migration import Migration
from utils import setup_logging

logger = logging.getLogger(__name__)


def main():
    setup_logging()
    logger.info("Hello from Unified Annotation Versioning Migration!")
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=str, help="Source fossildb host and port. Example: localhost:7155", required=True)
    parser.add_argument("--dst", type=str, help="Destination fossildb host and port", required=False)
    parser.add_argument("--dry", help="Only read and process data, do not write out results", action="store_true")
    parser.add_argument("--num_threads", help="Number of threads to migrate the annotations in parallel", type=int, default=1)
    parser.add_argument("--postgres", help="Postgres connection specifier.", type=str, default="postgres@localhost:5432/webknossos")
    args = parser.parse_args()
    if args.dst is None and not args.dry:
        parser.error("At least one of --dry or --dst is required")
    migration = Migration(args)
    migration.run()


if __name__ == '__main__':
    main()
