#!/usr/bin/env python3

import json
import grpc
import sys
from collections import defaultdict
import logging
import datetime
from timeit import default_timer as timer

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

import EditableMapping_pb2

import EditableMappingInfo_pb2
import SegmentToAgglomerateProto_pb2


fossilHost = "localhost:7155"

verbose = False
doWrite = True

# TODO snake_case

# To minimize downtime for instances with large editable mappings: run with migrateHistory=False
# Then, while the new wk is already running, run with migrateHistory=True
# the history is not currently used (we’d migrate it only to support possibly later-added feature of version restore)
migrateHistory = False

MAX_MESSAGE_LENGTH = 1073741824

collectionEditableMappings = "editableMappings"
collectionEditableMappingsInfo = "editableMappingsInfo"
collectionSegmentToAgglomerate = "editableMappingsSegmentToAgglomerate"
collectionAgglomerateToGraph = "editableMappingsAgglomerateToGraph"
listKeysBatchSize = 100

segmentToAgglomerateChunkSize = 64 * 1024 # max 1MB chunks (two 8-byte numbers per element) # must match the value in new wk code
persistedVersionInterval = 20

def main():

    print(f"Starting migration script (doWrite={doWrite}) at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    startTime = timer()

    channel = grpc.insecure_channel(fossilHost, options=[("grpc.max_send_message_length", MAX_MESSAGE_LENGTH), ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH)])
    stub = proto_rpc.FossilDBStub(channel)

    testHealth(stub, f"fossildb at {fossilHost}")

    putCount = 0

    lastListedKey = None
    while True:
        listKeysReply = stub.ListKeys(proto.ListKeysRequest(collection=collectionEditableMappings, limit=listKeysBatchSize, startAfterKey=lastListedKey))
        assertSuccess(listKeysReply)
        if len(listKeysReply.keys) == 0:
            break
        for key in listKeysReply.keys:
            print(f"Getting newest version for {key}...")
            getReply = stub.Get(proto.GetRequest(collection=collectionEditableMappings, key=key, version=None))
            assertSuccess(getReply)

            convertAndSave(key, getReply.actualVersion, getReply.value, stub, putCount)

            if migrateHistory:
                nextVersion = getReply.actualVersion - persistedVersionInterval
                # TODO: ensure v0 is always migrated
                while nextVersion >= 0:
                    print(f"Getting {key} v{nextVersion}...")
                    getReply = stub.Get(proto.GetRequest(collection=collectionEditableMappings, key=key, version=nextVersion))
                    assertSuccess(getReply)
                    convertAndSave(key, getReply.actualVersion, getReply.value, stub, putCount)
                    nextVersion = getReply.actualVersion - persistedVersionInterval

        lastListedKey = listKeysReply.keys[-1]

    print(f"Done after {timer() - startTime}. Total put count:", putCount)


def convertAndSave(key, version, editableMappingBytes, stub, putCount):
    print(f"For {key} got version {version} ({len(editableMappingBytes)} bytes) at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}...")
    editableMapping = EditableMapping_pb2.EditableMappingProto()
    editableMapping.ParseFromString(editableMappingBytes)
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
