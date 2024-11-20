#!/usr/bin/env python3

import argparse
import grpc
import sys
import logging
import datetime
import psycopg2
import psycopg2.extras
import math
import logging
import datetime

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def main():
    setup_logging()
    logger.info("Hello from Unified Annotation Versioning Migration!")

    listKeysBatchSize = 300

    # src_stub = connect("localhost:2000")
    # dst_stub = connect("localhost:7199")

    start_time = datetime.datetime.now()

    logger.info(f"Using start time {start_time}")

    annotations = read_annotation_list(start_time)

    for annotation in annotations:
        migrate_annotation(annotation)


def setup_logging():
    root = logging.getLogger()
    root.setLevel(logging.DEBUG)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(logging.DEBUG)
    formatter = logging.Formatter("%(asctime)s %(levelname)-8s %(message)s")
    handler.setFormatter(formatter)
    root.addHandler(handler)


def migrate_annotation(annotation):
    print(f"Migrating annotation {annotation['_id']}...")
    # layerId → {version_before → version_after}
    layer_version_mapping = migrate_updates(annotation)
    migrate_materialized_layers(annotation, layer_version_mapping)


def migrate_updates(annotation):
    print(annotation)
    layers = annotation["layers"]


def migrate_materialized_layers(annotation, layer_version_mapping):
    for tracing_id in annotation["layers"]:
        migrate_materialized_layer(tracing_id, annotation["layers"][tracing_id], layer_version_mapping)


def migrate_materialized_layer(tracing_id, layer_type, layer_version_mapping):
    if layer_type == "Skeleton":
        migrate_skeleton_proto(tracing_id, layer_version_mapping)
    if layer_type == "Volume":
        migrate_volume_proto(tracing_id, layer_version_mapping)
        migrate_volume_buckets(tracing_id, layer_version_mapping)
        migrate_segment_index(tracing_id, layer_version_mapping)
        migrate_editable_mapping(tracing_id, layer_version_mapping)


def migrate_skeleton_proto(layer, layer_version_mapping):
    pass

def migrate_volume_proto(layer, layer_version_mapping):
   pass

def migrate_volume_buckets(layer, layer_version_mapping):
   pass

def migrate_segment_index(layer, layer_version_mapping):
   pass

def migrate_editable_mapping(layer, layer_version_mapping):
    migrate_editable_mapping_info(layer, layer_version_mapping)
    migrate_editable_mapping_agglomerate_to_graph(layer, layer_version_mapping)
    migrate_editable_mapping_segment_to_agglomerate(layer, layer_version_mapping)

def migrate_editable_mapping_info(layer, layer_version_mapping):
    pass

def migrate_editable_mapping_agglomerate_to_graph(layer, layer_version_mapping):
    pass

def migrate_editable_mapping_segment_to_agglomerate(layer, layer_version_mapping):
    pass

def insert_annotation_protos(annotation, layer_version_mapping):
    pass


def read_annotation_list(start_time: datetime):
    logger.info("Determining annotation count from postgres...")
    page_size = 1
    connection = psycopg2.connect(host="localhost", port=5432, database="webknossos", user='postgres', password='postgres')
    cursor = connection.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    modified_str = start_time.strftime("'%Y-%m-%d %H:%M:%S'")
    cursor.execute(f"SELECT COUNT(*) FROM webknossos.annotations WHERE modified < {modified_str}")
    annotation_count = cursor.fetchone()['count']
    logger.info(f"Loading infos of {annotation_count} annotations from postgres...")
    annotations = []
    for page_num in range(math.ceil(annotation_count / page_size)):
        query = f"""
            SELECT a._id, a.created, a.modified, JSON_OBJECT_AGG(al.tracingId, al.typ) AS layers
            FROM webknossos.annotation_layers al
            JOIN webknossos.annotations a on al._annotation = a._id
            WHERE a.modified < {modified_str}
            GROUP BY a._id
            ORDER BY a._id
            LIMIT {page_size}
            OFFSET {page_size * page_num}
            """
        cursor.execute(query)
        annotations += cursor.fetchall()
    return annotations


def connect(host):
    MAX_MESSAGE_LENGTH = 2147483647
    channel = grpc.insecure_channel(host, options=[("grpc.max_send_message_length", MAX_MESSAGE_LENGTH), ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH)])
    stub = proto_rpc.FossilDBStub(channel)
    test_health(stub, f"fossildb at {host}")
    return stub


def test_health(stub, label):
    try:
        reply = stub.Health(proto.HealthRequest())
        assert_success(reply)
        print('successfully connected to ' + label)
    except Exception as e:
        print('failed to connect to ' + label + ': ' + str(e))
        sys.exit(1)

def assert_success(reply):
    if not reply.success:
        raise Exception("reply.success failed: " + reply.errorMessage)


if __name__ == '__main__':
    main()
