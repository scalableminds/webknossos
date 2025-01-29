import logging
from utils import setup_logging, log_since
import argparse
from connections import connect_to_fossildb
import time
import fossildbapi_pb2 as proto
from typing import Optional
import msgspec

logger = logging.getLogger("migration-logs")


def main():
    logger.info("Hello from repari_editable_mapping_updates")
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=str, help="Fossildb host and port. Example: localhost:7155", required=True)
    parser.add_argument("--id_mapping", type=str, help="json file containing the id mapping determined by find_mapping_tracing_mapping.py", required=True)
    args = parser.parse_args()
    before = time.time()
    #stub = connect_to_fossildb(args.src, "target")

    with open(args.id_mapping, "rb") as infile:
        id_mapping = msgspec.json.decode(infile.read())
        for annotation_id in id_mapping.keys():
            for editable_mapping_id, tracing_id in id_mapping[annotation_id].items():
                logger.info(f"{editable_mapping_id} → {tracing_id} for annotation {annotation_id}...")

        log_since(before, f"Repairing all {len(id_mapping)} annotations")



if __name__ == '__main__':
    main()
