import grpc
import psycopg2
import psycopg2.extras
import logging

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

logger = logging.getLogger(__name__)


def connect_to_fossildb(host):
    max_message_length = 2147483647
    channel = grpc.insecure_channel(host, options=[("grpc.max_send_message_length", max_message_length), ("grpc.max_receive_message_length", max_message_length)])
    stub = proto_rpc.FossilDBStub(channel)
    test_fossildb_health(stub, f"Fossildb at {host}")
    return stub


def test_fossildb_health(stub, label):
    reply = stub.Health(proto.HealthRequest())
    assert_grpc_success(reply)
    logger.info('Successfully connected to ' + label)


def assert_grpc_success(reply):
    if not reply.success:
        raise Exception("reply.success failed: " + reply.errorMessage)


def connect_to_postgres():
    return psycopg2.connect(host="localhost", port=5432, database="webknossos", user='postgres', password='postgres')
