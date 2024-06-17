#!/usr/bin/env python3

# Migrating Editable Mappings a.k.a. proofreading annotations
# 2023-04 https://github.com/scalableminds/webknossos/pull/6903
#
## Required python packages:
# pip install grpcio-tools grpcio-health-checking
#
## Development
# Note: the generated proto python classes are checked into the repostitory next to this file.
#       To regenerate them, both old and new format editable mapping proto definitions are needed.
#
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. --grpc_python_out=. ../../webknossos/webknossos-datastore/proto/fossildbapi.proto
#
### from old code:
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/EditableMapping.proto
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/geometry.proto
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/SkeletonTracing.proto
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/VolumeTracing.proto
#
### from new code / editable mapping distributed branch:
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/EditableMappingInfo.proto
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/SegmentToAgglomerateProto.proto
# python3 -m grpc_tools.protoc -I../../webknossos/webknossos-datastore/proto --python_out=. ../../webknossos/webknossos-datastore/proto/AgglomerateGraph.proto



import json
import grpc
import sys
import logging
import datetime
from collections import defaultdict
import argparse
from timeit import default_timer as timer

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

import EditableMapping_pb2

import EditableMappingInfo_pb2
import SegmentToAgglomerateProto_pb2

MAX_MESSAGE_LENGTH = 1073741824

collection_editable_mappings = "editableMappings"
collection_editable_mappings_info = "editableMappingsInfo"
collection_segment_to_agglomerate = "editableMappingsSegmentToAgglomerate"
collection_agglomerate_to_graph = "editableMappingsAgglomerateToGraph"
list_keys_batch_size = 100

segment_to_agglomerate_chunk_size = 64 * 1024 # max 1MB chunks (two 8-byte numbers per element) # must match the value in new wk code
persisted_version_interval = 20

put_count = 0

def main():
    global put_count
    parser = argparse.ArgumentParser()
    parser.add_argument("fossil_host", help="example: localhost:7155")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("-w", "--do_write", action="store_true")
    parser.add_argument("-o", "--do_migrate_older_versions", action="store_true", help="To minimize downtime for instances with large editable mappings: run without -o. Then, while the new wk is already running, run with -o. The history is not currently used by wk (we’d migrate it only to support possibly later-added feature of version restore)")
    args = parser.parse_args()

    print(f"Starting migration script (do_write={args.do_write}) at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    start_time = timer()

    channel = grpc.insecure_channel(args.fossil_host, options=[("grpc.max_send_message_length", MAX_MESSAGE_LENGTH), ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH)])
    stub = proto_rpc.FossilDBStub(channel)

    test_health(stub, f"fossildb at {args.fossil_host}")

    previous_listed_key = None
    while True:
        list_keys_reply = stub.ListKeys(proto.ListKeysRequest(collection=collection_editable_mappings, limit=list_keys_batch_size, startAfterKey=previous_listed_key))
        assert_success(list_keys_reply)
        if len(list_keys_reply.keys) == 0:
            break
        for key in list_keys_reply.keys:
            print(f"Getting newest version for {key}...")
            get_reply = stub.Get(proto.GetRequest(collection=collection_editable_mappings, key=key, version=None))
            assert_success(get_reply)

            convert_and_save(key, get_reply.actualVersion, get_reply.value, stub, args)
            migrated_versions = {get_reply.actualVersion}

            if args.do_migrate_older_versions:
                next_version = get_reply.actualVersion - persisted_version_interval
                while next_version >= 0:
                    print(f"Getting {key} v{next_version}...")
                    get_reply = stub.Get(proto.GetRequest(collection=collection_editable_mappings, key=key, version=next_version))
                    assert_success(get_reply)
                    convert_and_save(key, get_reply.actualVersion, get_reply.value, stub, args)
                    migrated_versions.add(get_reply.actualVersion)
                    next_version = get_reply.actualVersion - persisted_version_interval
                if 0 not in migrated_versions:
                    print(f"Getting {key} v0...")
                    get_reply = stub.Get(proto.GetRequest(collection=collection_editable_mappings, key=key, version=0))
                    assert_success(get_reply)
                    convert_and_save(key, get_reply.actualVersion, get_reply.value, stub, args)

        previous_listed_key = list_keys_reply.keys[-1]

    print(f"Done after {ms(timer() - start_time)}. Total put count:", put_count)


def convert_and_save(key, version, editable_mapping_bytes, stub, args):
    global put_count
    print(f"  For {key} got v{version} ({len(editable_mapping_bytes)} bytes) at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")
    editable_mapping = EditableMapping_pb2.EditableMappingProto()
    editable_mapping.ParseFromString(editable_mapping_bytes)
    segmentToAgglomerate = editable_mapping.segmentToAgglomerate
    largest_agglomerate_id = 0

    t5 = timer()
    chunks = {}
    for pair in editable_mapping.segmentToAgglomerate:
        pair_converted = SegmentToAgglomerateProto_pb2.SegmentAgglomeratePair()
        pair_converted.segmentId = pair.segmentId
        pair_converted.agglomerateId = pair.agglomerateId
        chunk_id = pair.segmentId // segment_to_agglomerate_chunk_size
        if chunk_id not in chunks:
            chunks[chunk_id] = SegmentToAgglomerateProto_pb2.SegmentToAgglomerateProto()
        chunks[chunk_id].segmentToAgglomerate.append(pair_converted)
    t6 = timer()
    if args.verbose:
        print(f"  grouping chunks took {ms(t6 - t5)}")
    for chunk_id, chunk in chunks.items():
        chunk_key = f"{key}/{chunk_id}"
        chunkBytes = chunk.SerializeToString()
        if args.verbose:
            print(f"    segment to agglomerate chunk with {len(chunk.segmentToAgglomerate)} pairs, to be saved at {chunk_key} v{version}")
        if args.do_write:
            put_reply = stub.Put(proto.PutRequest(collection=collection_segment_to_agglomerate, key=chunk_key, version=version, value=chunkBytes))
            assert_success(put_reply)
            put_count += 1

    t7 = timer()
    for agglomerateToGraphPair in editable_mapping.agglomerateToGraph:
        agglomerateId = agglomerateToGraphPair.agglomerateId
        largest_agglomerate_id = max(largest_agglomerate_id, agglomerateId)
        graph = agglomerateToGraphPair.agglomerateGraph
        agglomerateToGraphKey = f"{key}/{agglomerateId}"
        graphBytes = graph.SerializeToString()
        if args.verbose:
            print(f"    agglomerate {agglomerateId} has graph with {len(graph.edges)} edges, to be saved at {agglomerateToGraphKey} v{version}")
        if args.do_write:
            put_reply = stub.Put(proto.PutRequest(collection=collection_agglomerate_to_graph, key=agglomerateToGraphKey, version=version, value=graphBytes))
            assert_success(put_reply)
            put_count += 1

    if args.verbose:
        print(f"  converting + putting graphs took {ms(timer() - t7)}")

    editable_mapping_info = EditableMappingInfo_pb2.EditableMappingInfo()
    editable_mapping_info.baseMappingName = editable_mapping.baseMappingName
    editable_mapping_info.createdTimestamp = editable_mapping.createdTimestamp
    editable_mapping_info.largestAgglomerateId = largest_agglomerate_id

    if args.verbose:
        print(f"  EditableMappingInfo with largest agglomerate id {editable_mapping_info.largestAgglomerateId}, to be saved at {key} v{version}")
    info_bytes = editable_mapping_info.SerializeToString()
    if args.do_write:
        put_reply = stub.Put(proto.PutRequest(collection=collection_editable_mappings_info, key=key, version=version, value=info_bytes))
        assert_success(put_reply)
        put_count += 1

def ms(time_diff):
    return f"{int(time_diff*1000)} ms"

def test_health(stub, label):
    try:
        reply = stub.Health(proto.HealthRequest())
        assert_success(reply)
        print('Successfully connected to ' + label)
    except Exception as e:
        print('Failed to connect to ' + label + ': ' + str(e))
        sys.exit(1)

def assert_success(reply):
    if not reply.success:
        raise Exception("reply.success failed: " + reply.errorMessage)

if __name__ == '__main__':
    main()
