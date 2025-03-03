import logging
from utils import setup_logging, log_since
import argparse
from connections import connect_to_fossildb, connect_to_postgres, assert_grpc_success
import psycopg2
import psycopg2.extras
import time
import fossildbapi_pb2 as proto
import VolumeTracing_pb2 as Volume
from typing import Optional
import msgspec

logger = logging.getLogger(__name__)


def main():
    print("Hello from count_skeleton_keys")
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=str, help="Source fossildb host and port. Example: localhost:7155", required=True)
    args = parser.parse_args()
    before = time.time()
    src_stub = connect_to_fossildb(args.src, "source")
    collection = "skeletons"
    list_keys_page_size = 100
    key_count = 0
    current_start_after_key = None
    while True:
        print(key_count, end=" ", flush=True)
        list_keys_reply = src_stub.ListKeys(proto.ListKeysRequest(collection=collection, limit=list_keys_page_size, startAfterKey=current_start_after_key))
        assert_grpc_success(list_keys_reply)
        this_page_key_count = len(list_keys_reply.keys)
        key_count += this_page_key_count
        if this_page_key_count == 0:
            # We iterated towards the very end of the collection
            break
        current_start_after_key = list_keys_reply.keys[-1]
    log_since(before, f"Saw {key_count} keys.")


if __name__ == '__main__':
    main()
