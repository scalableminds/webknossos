import logging
from utils import setup_logging, log_since, batch_range
import argparse
from connections import connect_to_fossildb, assert_grpc_success
import time
import fossildbapi_pb2 as proto
from typing import List, Tuple
import msgspec

logger = logging.getLogger("migration-logs")


def main():
    logger.info("Hello from repair_editable_mapping_updates")
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--fossil", type=str, help="Fossildb host and port. Example: localhost:7155", required=True)
    parser.add_argument("--id_mapping", type=str, help="json file containing the id mapping determined by find_mapping_tracing_mapping.py", required=True)
    args = parser.parse_args()
    before = time.time()
    stub = connect_to_fossildb(args.fossil, "target")

    json_encoder = msgspec.json.Encoder()
    json_decoder = msgspec.json.Decoder()
    with open(args.id_mapping, "rb") as infile:
        id_mapping = json_decoder.decode(infile.read())
        for annotation_id in id_mapping.keys():
            repair_updates_of_annotation(stub, annotation_id, id_mapping[annotation_id], json_encoder, json_decoder)

        log_since(before, f"Repairing all {len(id_mapping)} annotations")


def repair_updates_of_annotation(stub, annotation_id, id_mapping_for_annotation, json_encoder, json_decoder):
    get_batch_size = 100  # in update groups
    put_buffer_size = 100  # in update groups

    before = time.time()
    put_buffer = []
    changed_update_count = 0
    newest_version = get_newest_version(stub, annotation_id, "annotationUpdates")
    if newest_version > 10000:
        logger.info(f"Newest version of {annotation_id} is {newest_version}. This may take some time...")
    for batch_start, batch_end in reversed(list(batch_range(newest_version + 1, get_batch_size))):
        update_groups_batch = get_update_batch(stub, annotation_id, batch_start, batch_end - 1)
        for version, update_group_bytes in update_groups_batch:
            update_group = json_decoder.decode(update_group_bytes)
            group_changed = False
            for update in update_group:
                if "value" in update:
                    update_value = update["value"]
                    if "actionTracingId" in update_value and update_value["actionTracingId"] in id_mapping_for_annotation:
                        update_value["actionTracingId"] = id_mapping_for_annotation[update_value["actionTracingId"]]
                        group_changed = True
                        changed_update_count += 1
            if group_changed:
                versioned_key_value_pair = proto.VersionedKeyValuePairProto()
                versioned_key_value_pair.key = annotation_id
                versioned_key_value_pair.version = version
                versioned_key_value_pair.value = json_encoder.encode(update_group)
                put_buffer.append(versioned_key_value_pair)
                if len(put_buffer) >= put_buffer_size:
                    put_multiple_keys_versions(stub, "annotationUpdates", put_buffer)
                    put_buffer = []
    if len(put_buffer) > 0:
        put_multiple_keys_versions(stub, "annotationUpdates", put_buffer)
    log_since(before, f"Repaired {changed_update_count} updates of annotation {annotation_id},")


def put_multiple_keys_versions(stub, collection: str, to_put) -> None:
    reply = stub.PutMultipleKeysWithMultipleVersions(proto.PutMultipleKeysWithMultipleVersionsRequest(collection=collection, versionedKeyValuePairs = to_put))
    assert_grpc_success(reply)


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
