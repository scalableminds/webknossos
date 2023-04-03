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

MAX_MESSAGE_LENGTH = 1073741824


def main():
    verbose = True
    doWrite = True

    collectionEditableMappings = "editableMappings"
    collectionEditableMappingsInfo = "editableMappingsInfo"
    collectionSegmentToAgglomerate = "editableMappingsSegmentToAgglomerate"
    collectionAgglomerateToGraph = "editableMappingsAgglomerateToGraph"

    fossilHost = "localhost:7155"

    channel = grpc.insecure_channel(fossilHost, options=[("grpc.max_send_message_length", MAX_MESSAGE_LENGTH), ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH)])
    stub = proto_rpc.FossilDBStub(channel)

    testHealth(stub, f"fossildb at {fossilHost}")

    listKeysBatchSize = 100

    putCount = 0

    segmentToAgglomerateChunkSize = 16 * 1024

    lastKey = None
    while True:
        listKeysReply = stub.ListKeys(proto.ListKeysRequest(collection=collectionEditableMappings, limit=listKeysBatchSize, startAfterKey=lastKey))
        assertSuccess(listKeysReply)
        if len(listKeysReply.keys) == 0:
            break
        for key in listKeysReply.keys:
            getMultipleVersionsReply = stub.GetMultipleVersions(proto.GetMultipleVersionsRequest(collection=collectionEditableMappings, key=key))
            assertSuccess(getMultipleVersionsReply)
            for version, valueBytes in zip(getMultipleVersionsReply.versions, getMultipleVersionsReply.values):
                print(f"handling {key} v{version}...")
                editableMapping = EditableMapping_pb2.EditableMappingProto()
                editableMapping.ParseFromString(valueBytes)
                segmentToAgglomerate = editableMapping.segmentToAgglomerate
                largestAgglomerateId = 0

                chunks = defaultdict(list)
                for pair in editableMapping.segmentToAgglomerate:
                    chunk_id = pair.segmentId // segmentToAgglomerateChunkSize
                    chunks[chunk_id].append(pair)
                for chunk_id, chunk in chunks.items():
                    chunk_key = f"{key}/{chunk_id}"
                    chunk_wrapped = SegmentToAgglomerateProto_pb2.SegmentToAgglomerateProto()
                    for pair in chunk:
                        pair_converted = SegmentToAgglomerateProto_pb2.SegmentAgglomeratePair()
                        pair_converted.segmentId = pair.segmentId
                        pair_converted.agglomerateId = pair.agglomerateId
                        chunk_wrapped.segmentToAgglomerate.append(pair_converted)
                    chunkBytes = chunk_wrapped.SerializeToString()
                    if verbose:
                        print(f"segment to agglomerate chunk with {len(chunk)} pairs, to be saved at {chunk_key} v{version}")
                    if doWrite:
                        putReply = stub.Put(proto.PutRequest(collection=collectionSegmentToAgglomerate, key=chunk_key, version=version, value=chunkBytes))
                        assertSuccess(putReply)
                        putCount += 1

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

    print("Done. total put count:", putCount)

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
