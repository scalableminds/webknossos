"""Virtual WebAuthn authenticator for the differential tests (stdlib only; never for real use).

ES256 (P-256) credentials with "none" attestation. Keys and credential ids are derived from a
name, so both backends store byte-identical credentials and the database diff can compare them.
Used by replay.py step hooks (`"hook": "webauthn_register"` / `"webauthn_authenticate"`).
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import struct
import urllib.parse

# NIST P-256
P = 2**256 - 2**224 + 2**192 + 2**96 - 1
A = P - 3
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def point_add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if p1 == p2:
        slope = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        slope = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (slope * slope - x1 - x2) % P
    return x3, (slope * (x1 - x3) - y1) % P


def scalar_mult(k: int, point=G):
    result = None
    while k:
        if k & 1:
            result = point_add(result, point)
        point = point_add(point, point)
        k >>= 1
    return result


def der_integer(value: int) -> bytes:
    raw = value.to_bytes((value.bit_length() + 8) // 8, "big")  # leading 0x00 keeps it positive
    return b"\x02" + bytes([len(raw)]) + raw


class Credential:
    def __init__(self, name: str) -> None:
        seed = hashlib.sha256(f"wk-diff-credential:{name}".encode()).digest()
        self.private = int.from_bytes(seed, "big") % (N - 1) + 1
        self.public = scalar_mult(self.private)
        self.id = hashlib.sha256(f"wk-diff-credential-id:{name}".encode()).digest()[:16]

    def sign(self, message: bytes) -> bytes:
        """ECDSA over SHA-256, DER-encoded (as authenticators return it)."""
        e = int.from_bytes(hashlib.sha256(message).digest(), "big")
        while True:
            k = secrets.randbelow(N - 1) + 1
            r = scalar_mult(k)[0] % N
            s = pow(k, -1, N) * (e + r * self.private) % N
            if r and s:
                body = der_integer(r) + der_integer(s)
                return b"\x30" + bytes([len(body)]) + body

    def cose_key(self) -> bytes:
        x, y = self.public
        return cbor({1: 2, 3: -7, -1: 1, -2: x.to_bytes(32, "big"), -3: y.to_bytes(32, "big")})


def cbor_head(major: int, value: int) -> bytes:
    if value < 24:
        return bytes([major << 5 | value])
    for info, size in ((24, 1), (25, 2), (26, 4), (27, 8)):
        if value < 1 << (8 * size):
            return bytes([major << 5 | info]) + value.to_bytes(size, "big")
    raise ValueError("CBOR value too large")


def cbor(value) -> bytes:
    if isinstance(value, bool) or value is None:
        return bytes([0xF5 if value is True else 0xF4 if value is False else 0xF6])
    if isinstance(value, int):
        return cbor_head(0, value) if value >= 0 else cbor_head(1, -1 - value)
    if isinstance(value, bytes):
        return cbor_head(2, len(value)) + value
    if isinstance(value, str):
        data = value.encode()
        return cbor_head(3, len(data)) + data
    if isinstance(value, dict):
        return cbor_head(5, len(value)) + b"".join(cbor(k) + cbor(v) for k, v in value.items())
    raise TypeError(type(value))


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def client_data(kind: str, challenge: str, origin: str) -> bytes:
    return json.dumps({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False},
                      separators=(",", ":")).encode()


def authenticator_data(rp_id: str, sign_count: int, attested: bytes = b"") -> bytes:
    flags = 0x01 | 0x04 | (0x40 if attested else 0)  # user present, user verified, attested data
    return hashlib.sha256(rp_id.encode()).digest() + bytes([flags]) + struct.pack(">I", sign_count) + attested


def registration(options: dict, origin: str, credential: Credential, sign_count: int = 0) -> dict:
    rp_id = options["rp"]["id"]
    attested = bytes(16) + struct.pack(">H", len(credential.id)) + credential.id + credential.cose_key()
    attestation = cbor({"fmt": "none", "attStmt": {}, "authData": authenticator_data(rp_id, sign_count, attested)})
    return {"id": b64url(credential.id), "rawId": b64url(credential.id), "type": "public-key",
            "authenticatorAttachment": "platform", "clientExtensionResults": {},
            "response": {"clientDataJSON": b64url(client_data("webauthn.create", options["challenge"], origin)),
                         "attestationObject": b64url(attestation), "transports": ["internal"]}}


def assertion(options: dict, origin: str, credential: Credential, user_handle: str, sign_count: int) -> dict:
    rp_id = options.get("rpId") or urllib.parse.urlsplit(origin).hostname
    auth_data = authenticator_data(rp_id, sign_count)
    data = client_data("webauthn.get", options["challenge"], origin)
    signature = credential.sign(auth_data + hashlib.sha256(data).digest())
    return {"id": b64url(credential.id), "rawId": b64url(credential.id), "type": "public-key",
            "authenticatorAttachment": "platform", "clientExtensionResults": {},
            "response": {"clientDataJSON": b64url(data), "authenticatorData": b64url(auth_data),
                         "signature": b64url(signature), "userHandle": user_handle}}


def hook(name: str, variables: dict, args: dict) -> dict:
    """Request bodies for replay.py. `variables` are one side's captures; returns the JSON body.

    webauthn_register:     {"options": var, "credential": name, "name": key name, "origin": url,
                            "challenge_override": optional}
    webauthn_authenticate: {"options": var, "credential": name, "user_handle_from": var of the
                            registration options, "sign_count": n, "origin": url, "tamper": optional}
    """
    options = variables[args["options"]]
    credential = Credential(args["credential"])
    origin = args["origin"]
    if "challenge_override" in args:
        options = {**options, "challenge": args["challenge_override"]}
    if name == "webauthn_register":
        return {"name": args["name"], "key": registration(options, origin, credential)}
    if name == "webauthn_authenticate":
        user_handle = variables[args["user_handle_from"]]["user"]["id"]
        key = assertion(options, origin, credential, user_handle, int(args.get("sign_count", 1)))
        if args.get("tamper") == "signature":
            key["response"]["signature"] = b64url(Credential("someone-else").sign(b"x"))
        return {"key": key}
    raise KeyError(name)
