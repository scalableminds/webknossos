import grpc
import psycopg2
import psycopg2.extras
import logging
import re
from typing import Dict, Any
import os

import fossildbapi_pb2 as proto
import fossildbapi_pb2_grpc as proto_rpc

logger = logging.getLogger(__name__)


def connect_to_fossildb(host: str, label: str):
    max_message_length = 2147483647  # 2G
    channel = grpc.insecure_channel(host, options=[("grpc.max_send_message_length", max_message_length), ("grpc.max_receive_message_length", max_message_length)])
    stub = proto_rpc.FossilDBStub(channel)
    test_fossildb_health(stub, f"{label} FossilDB at {host}")
    return stub


def test_fossildb_health(stub, label):
    reply = stub.Health(proto.HealthRequest())
    assert_grpc_success(reply)
    logger.info(f"Successfully connected to {label}")


def assert_grpc_success(reply):
    if not reply.success:
        raise Exception("reply.success failed: " + reply.errorMessage)


def connect_to_postgres(postgres_config: str):
    parsed = parse_connection_string(postgres_config)
    password = os.environ.get("PG_PASSWORD", "postgres")
    return psycopg2.connect(host=parsed["host"], port=parsed["port"], database=parsed["database"], user=parsed["user"], password=password)


def parse_connection_string(connection_string: str) -> Dict[str, Any]:
    pattern = r"^(?P<user>\w+)@(?!.*@)(?P<host>[^:/]+)(?::(?P<port>\d+))?(?P<database>/[^ ]*)?$"

    match = re.match(pattern, connection_string.removeprefix("postgresql://"))
    if match:
        return {
            "user": match.group("user"),
            "host": match.group("host"),
            "port": int(match.group("port")),
            "database": match.group("database").lstrip("/")
        }
    else:
        raise ValueError("Invalid postgres connection string, needs to be postgresql://user@host:port/database.")
