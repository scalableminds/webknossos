#!/usr/bin/env python3

import argparse
import grpc
import sys
import logging
import datetime

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

MAX_MESSAGE_LENGTH = 2147483647

def main():

    listKeysBatchSize = 300

    src_stub = connect("localhost:2000")
    dst_stub = connect("localhost:7199")

    test_health(src_stub, f"source fossildb at {src_host}")
    test_health(dst_stub, f"destination fossildb at {dst_host}")




def connect(host):
    MAX_MESSAGE_LENGTH = 2147483647
    channel = grpc.insecure_channel(host, options=[("grpc.max_send_message_length", MAX_MESSAGE_LENGTH), ("grpc.max_receive_message_length", MAX_MESSAGE_LENGTH)])
    stub = proto_rpc.FossilDBStub(channel)
    test_health(stub, f"fossildb at {host}")
    return stub


def test_health(stub, label):
    try:
        reply = stub.Health(proto.HealthRequest())
        assertSuccess(reply)
        print('successfully connected to ' + label)
    except Exception as e:
        print('failed to connect to ' + label + ': ' + str(e))
        sys.exit(1)

def assert_success(reply):
    if not reply.success:
        raise Exception("reply.success failed: " + reply.errorMessage)


if __name__ == '__main__':
    main()
