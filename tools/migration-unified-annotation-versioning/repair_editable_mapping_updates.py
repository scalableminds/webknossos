import logging
from utils import setup_logging, log_since, batch_range
import argparse
from connections import connect_to_fossildb, assert_grpc_success
import time
import fossildbapi_pb2 as proto
from typing import Optional, List, Tuple
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
    stub = connect_to_fossildb(args.src, "target")

    json_encoder = msgspec.json.Encoder()
    json_decoder = msgspec.json.Decoder()
    with open(args.id_mapping, "rb") as infile:
        id_mapping = json_decoder.decode(infile.read())
        for annotation_id in id_mapping.keys():
            for editable_mapping_id, tracing_id in id_mapping[annotation_id].items():
                logger.info(f"{editable_mapping_id} → {tracing_id} for annotation {annotation_id}...")
            migrate_updates(stub, annotation_id, id_mapping[annotation_id], json_encoder, json_decoder)

        log_since(before, f"Repairing all {len(id_mapping)} annotations")


def migrate_updates(stub, annotation_id, id_mapping_for_annotation, json_encoder, json_decoder):
    get_batch_size = 100 # in update groups
    put_buffer_size = 100 # in update groups
    put_buffer = []
    newest_version = get_newest_version(stub, annotation_id, "annotationUpdates")
    for batch_start, batch_end in reversed(list(batch_range(newest_version + 1, get_batch_size))):
        update_groups_batch = get_update_batch(stub, annotation_id, batch_start, batch_end - 1)
        for version, update_group_bytes in update_groups_batch:
            update_group = json_decoder.decode(update_group_bytes)
            group_changed = False
            for update in update_group:
                if "actionTracingId" in update and update["actionTracingId"] in id_mapping_for_annotation:
                    update["actionTracingId"] = id_mapping_for_annotation[update["actionTracingId"]]
                    group_changed = True
            if group_changed:
                put_buffer.append((version, update_group))
                if len(put_buffer) >= put_buffer_size:
                    logger.info("putting")
                    put_buffer = []
    if len(put_buffer) > 0:
        logger.info("putting")


def get_update_batch(stub, annotation_id: str, batch_start: int, batch_end_inclusive: int) -> List[Tuple[int, bytes]]:
    reply = stub.GetMultipleVersions(
        proto.GetMultipleVersionsRequest(collection="annotationUpdates", key=annotation_id, oldestVersion=batch_start, newestVersion=batch_end_inclusive)
    )
    assert_grpc_success(reply)
    reply.versions.reverse()
    reply.values.reverse()
    return list(zip(reply.versions, reply.values))


def get_newest_version(stub, tracing_id: str, collection: str) -> int:
    getReply = stub.Get(
        proto.GetRequest(collection=collection, key=tracing_id, mayBeEmpty=True)
    )
    if getReply.success:
        return getReply.actualVersion
    return 0


if __name__ == '__main__':
    main()
