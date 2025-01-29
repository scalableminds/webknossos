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
    logger.info("Hello from find_mapping_tracing_mapping")
    setup_logging()
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", type=str, help="Source fossildb host and port. Example: localhost:7155", required=True)
    parser.add_argument("--postgres", help="Postgres connection specifier, default is postgresql://postgres@localhost:5432/webknossos", type=str, default="postgresql://postgres@localhost:5432/webknossos")
    args = parser.parse_args()
    before = time.time()
    annotations = read_annotation_list(args)
    src_stub = connect_to_fossildb(args.src, "source")
    mappings = []
    for annotation in annotations:
        annotation_id = annotation["_id"]
        id_mapping_for_annotation = {}
        for tracing_id, layer_type in annotation["layers"].items():
            if layer_type == 'Volume':
                try:
                    editable_mapping_id = get_editable_mapping_id(src_stub, tracing_id, layer_type)
                    if editable_mapping_id is not None:
                        id_mapping_for_annotation[editable_mapping_id] = tracing_id
                except Exception as e:
                    logger.info(f"exception while checking layer {tracing_id} of {annotation_id}: {e}")
        if id_mapping_for_annotation:
            mappings.append(id_mapping_for_annotation)

    outfile_name = "mapping_tracing_mapping.json"
    logger.info(f"Writing mapping to {outfile_name}...")
    with open(outfile_name, "wb") as outfile:
        outfile.write(msgspec.json.encode(mappings))

    log_since(before, f"Wrote full id mapping to {outfile_name}. Checked {len(annotations)} annotations, wrote {len(mappings)} annotation id mappings.")


def get_newest_tracing_raw(src_stub, tracing_id, collection) -> Optional[bytes]:
    getReply = src_stub.Get(
        proto.GetRequest(collection=collection, key=tracing_id, mayBeEmpty=True)
    )
    assert_grpc_success(getReply)
    return getReply.value


def get_editable_mapping_id(src_stub, tracing_id: str, layer_type: str) -> Optional[str]:
    if layer_type == "Skeleton":
        return None
    tracing_raw = get_newest_tracing_raw(src_stub, tracing_id, "volumes")
    if tracing_raw is None:
        return None
    volume = Volume.VolumeTracing()
    volume.ParseFromString(tracing_raw)
    if volume.hasEditableMapping:
        return volume.mappingName
    return None


def read_annotation_list(args):
    before = time.time()
    connection = connect_to_postgres(args.postgres)
    cursor = connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cursor.execute(f"SELECT COUNT(*) FROM webknossos.annotations")
    annotation_count = cursor.fetchone()['count']
    logger.info(f"Loading infos of {annotation_count} annotations from postgres ...")
    query = f"""SELECT
                  a._id,
                  JSON_OBJECT_AGG(al.tracingId, al.typ) AS layers,
                  JSON_OBJECT_AGG(al.tracingId, al.name) AS layerNames
                FROM webknossos.annotation_layers al
                JOIN webknossos.annotations a on al._annotation = a._id
                GROUP BY a._id
                """
    cursor.execute(query)
    annotations = cursor.fetchall()
    log_since(before, "Loading annotation infos from postgres")
    return annotations

if __name__ == '__main__':
    main()
