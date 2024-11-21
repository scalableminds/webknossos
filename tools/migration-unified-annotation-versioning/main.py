#!/usr/bin/env python3

import logging
from migration import Migration
from utils import setup_logging

logger = logging.getLogger(__name__)


def main():
    setup_logging()
    logger.info("Hello from Unified Annotation Versioning Migration!")
    args = {}
    migration = Migration(args)
    migration.run()


if __name__ == '__main__':
    main()
