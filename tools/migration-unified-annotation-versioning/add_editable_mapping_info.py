import logging
from utils import setup_logging, log_since
import argparse
from connections import connect_to_fossildb, assert_grpc_success
import time
import fossildbapi_pb2 as proto


logger = logging.getLogger("migration-logs")


def main():
    logger.info("Hello from add_editable_mapping_info")
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--fossil", type=str, help="Fossildb host and port. Example: localhost:7155", required=True)
    parser.add_argument("--editable_mapping_info_file", type=str, help="path to binary input file to put", required=True)
    parser.add_argument("--tracingId", type=str, help="tracingId to put the entry to", required=True)
    parser.add_argument("--version", type=int, help="version number to put the entry to", required=True)
    args = parser.parse_args()
    before = time.time()
    stub = connect_to_fossildb(args.fossil, "target")
    with open(args.editable_mapping_info_file, 'rb') as infile:
        bytes_to_put = infile.read()

    logger.info(f"putting {len(bytes_to_put)} bytes of type {type(bytes_to_put)} at {args.tracingId} v{args.version}")
    reply = stub.Put(proto.PutRequest(collection="editableMappingsInfo", key=args.tracingId, version=args.version, value=bytes_to_put))
    assert_grpc_success(reply)
    log_since(before, "Inserting one editable mapping info entry")





if __name__ == '__main__':
    main()
