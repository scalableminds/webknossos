#!/usr/bin/env python3

import argparse
import grpc
import sys
import logging
import datetime
import psycopg2

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc


def main():

    listKeysBatchSize = 300

    # src_stub = connect("localhost:2000")
    # dst_stub = connect("localhost:7199")

    annotations = read_annotation_list()
    print(annotations)

    for annotation in annotations:
        migrate_annotation(annotation)


def migrate_annotation(annotation):
    print(f"Migrating annotation {annotation}")
    # layerId → {version_before → version_after}
    layer_version_mapping = migrate_updates(annotation)
    migrate_materialized_layers(annotation, layer_version_mapping)

def migrate_updates(annotation):
    layers = annotation.layers

def migrate_materialized_layers(annotation, layer_version_mapping):
    for layer in annotation.layers:
        migrate_materialized_layer(layer, layer_version_mapping)

def migrate_materialized_layer(layer, layer_version_mapping):
    if layer.type == "Skeleton":
        migrate_skeleton_proto(layer, layer_version_mapping)
    if layer.type == "Volume":
        migrate_volume_proto(layer, layer_version_mapping)
        migrate_volume_buckets(layer, layer_version_mapping)
        migrate_segment_index(layer, layer_version_mapping)
        migrate_editable_mapping(layer, layer_version_mapping)

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


def read_annotation_list():
    connection = psycopg2.connect(host="localhost", port=5432, database="webknossos", user='postgres', password='postgres')
    cursor = connection.cursor()
    query = "SELECT _id FROM webknossos.annotations"
    cursor.execute(query)
    records = cursor.fetchall()
    return records

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
