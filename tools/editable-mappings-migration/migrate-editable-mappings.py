#!/usr/bin/env python3

import json
import grpc
import sys
from collections import defaultdict

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

import EditableMapping_pb2

import EditableMappingInfo_pb2
import SegmentToAgglomerateProto_pb2
import logging
import datetime

from timeit import default_timer as timer

MAX_MESSAGE_LENGTH = 1073741824


def main():
    verbose = False
    doWrite = True
    print(f"Starting migration script (doWrite={doWrite}) at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    collectionEditableMappings = "editableMappings"
    collectionEditableMappingsInfo = "editableMappingsInfo"
    collectionSegmentToAgglomerate = "editableMappingsSegmentToAgglomerate"
    collectionAgglomerateToGraph = "editableMappingsAgglomerateToGraph"

    fossilHost = "localhost:7155"

    startTime = timer()

    channel = grpc.insecure_channel(fossilHost, options=[("grpc.max_send_message_length", MAX_MESSAGE_LENGTH), ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH)])
    stub = proto_rpc.FossilDBStub(channel)

    testHealth(stub, f"fossildb at {fossilHost}")

    listKeysBatchSize = 100

    putCount = 0

    segmentToAgglomerateChunkSize = 64 * 1024 # max 1MB chunks (two 8-byte numbers per element)

    lastKey = None
    while True:
        listKeysReply = stub.ListKeys(proto.ListKeysRequest(collection=collectionEditableMappings, limit=listKeysBatchSize, startAfterKey=lastKey))
        assertSuccess(listKeysReply)
        if len(listKeysReply.keys) == 0:
            break
        for key in listKeysReply.keys:
            print(f"listing versions for {key}...")
            # TODO instead of list versions, do get without version, then count down by 5 to 0?
            listVersionsReply  = stub.ListVersions(proto.ListVersionsRequest(collection=collectionEditableMappings, key=key))
            assertSuccess(listVersionsReply)
            versions = list(listVersionsReply.versions)
            for version in versions:
                print(f"Getting {key} v{version} (there are {len(versions)} versions total)...")
                getReply = stub.Get(proto.GetRequest(collection=collectionEditableMappings, key=key, version=version))
                assertSuccess(getReply)
                assert(version == getReply.actualVersion, f"got a different version from requested one for key {key} v{version} (got {getReply.actualVersion})")
                print(f"For {key} got version {getReply.actualVersion} ({len(getReply.value)} bytes) at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")

                editableMapping = EditableMapping_pb2.EditableMappingProto()
                editableMapping.ParseFromString(getReply.value)
                segmentToAgglomerate = editableMapping.segmentToAgglomerate
                largestAgglomerateId = 0

                t5 = timer()
                chunks = {}
                for pair in editableMapping.segmentToAgglomerate:
                    pair_converted = SegmentToAgglomerateProto_pb2.SegmentAgglomeratePair()
                    pair_converted.segmentId = pair.segmentId
                    pair_converted.agglomerateId = pair.agglomerateId
                    chunk_id = pair.segmentId // segmentToAgglomerateChunkSize
                    if chunk_id not in chunks:
                        chunks[chunk_id] = SegmentToAgglomerateProto_pb2.SegmentToAgglomerateProto()
                    chunks[chunk_id].segmentToAgglomerate.append(pair_converted)
                t6 = timer()
                if verbose:
                    print(f"grouping chunks {t6 - t5}")
                for chunk_id, chunk in chunks.items():
                    chunk_key = f"{key}/{chunk_id}"
                    chunkBytes = chunk.SerializeToString()
                    if verbose:
                        print(f"segment to agglomerate chunk with {len(chunk.segmentToAgglomerate)} pairs, to be saved at {chunk_key} v{version}")
                    if doWrite:
                        putReply = stub.Put(proto.PutRequest(collection=collectionSegmentToAgglomerate, key=chunk_key, version=version, value=chunkBytes))
                        assertSuccess(putReply)
                        putCount += 1

                t7 = timer()
                for agglomerateToGraphPair in editableMapping.agglomerateToGraph:
                    agglomerateId = agglomerateToGraphPair.agglomerateId
                    largestAgglomerateId = max(largestAgglomerateId, agglomerateId)
                    graph = agglomerateToGraphPair.agglomerateGraph
                    agglomerateToGraphKey = f"{key}/{agglomerateId}"
                    graphBytes = graph.SerializeToString()
                    if verbose:
                        print(f"agglomerate {agglomerateId} has graph with {len(graph.edges)} edges, to be saved at {agglomerateToGraphKey} v{version}")
                    if doWrite:
                        putReply = stub.Put(proto.PutRequest(collection=collectionAgglomerateToGraph, key=agglomerateToGraphKey, version=version, value=graphBytes))
                        assertSuccess(putReply)
                        putCount += 1

                if verbose:
                    print(f"converting + putting graphs: {timer() - t7}")

                editableMappingInfo = EditableMappingInfo_pb2.EditableMappingInfo()
                editableMappingInfo.baseMappingName = editableMapping.baseMappingName
                editableMappingInfo.createdTimestamp = editableMapping.createdTimestamp
                editableMappingInfo.largestAgglomerateId = largestAgglomerateId

                if verbose:
                    print(f"EditableMappingInfo with largest agglomerate id {editableMappingInfo.largestAgglomerateId}, to be saved at {key} v{version}")
                infoBytes = editableMappingInfo.SerializeToString()
                if doWrite:
                    putReply = stub.Put(proto.PutRequest(collection=collectionEditableMappingsInfo, key=key, version=version, value=infoBytes))
                    assertSuccess(putReply)
                    putCount += 1

        lastKey = listKeysReply.keys[-1]

    print(f"Done after {timer() - startTime}. Total put count:", putCount)

def testHealth(stub, label):
    try:
        reply = stub.Health(proto.HealthRequest())
        assertSuccess(reply)
        print('successfully connected to ' + label)
    except Exception as e:
        print('failed to connect to ' + label + ': ' + str(e))
        sys.exit(1)

def assertSuccess(reply):
    if not reply.success:
        raise Exception("reply.success failed: " + reply.errorMessage)

if __name__ == '__main__':
    main()
