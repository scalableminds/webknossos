#!/usr/bin/env python3
"""Minimal OpenID Connect provider for the differential tests (stdlib only; never for real use).

Serves discovery, JWKS and a token endpoint. Both Play and Rust are configured against it with
the same client, so the authorization `code` passed to /api/auth/oidc/callback selects the
provider's answer:

  sample2        id_token + access token for sample2@scm.io (existing user)
  newuser        claims of a user unknown to WEBKNOSSOS (first sign-on creates it)
  access-only    no id_token; the access token carries sample@scm.io's claims
  bad-signature  tokens signed with a key that is not in the JWKS
  expired        tokens whose exp lies in the past
  no-email       id_token without the email claim
  not-a-jwt      access_token that is not a JWT
  provider-error token endpoint answers 400 invalid_grant
  (any other)    400 invalid_grant

The token endpoint also rejects wrong client credentials, grant types and redirect URIs (400), so a
backend sending a different token request shows up as a divergent callback response.

  python3 tools/app_differential/oidc_mock.py --port 19589 --redirect-uri http://127.0.0.1:19590/api/auth/oidc/callback
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import secrets
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CLIENT_ID = "diff-client"
CLIENT_SECRET = "diff-secret"
SHA256_DIGEST_INFO = bytes.fromhex("3031300d060960864801650304020105000420")


def probable_prime(bits: int) -> int:
    while True:
        candidate = secrets.randbits(bits) | (1 << (bits - 1)) | 1
        if all(candidate % p for p in (3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37)) and miller_rabin(candidate):
            return candidate


def miller_rabin(n: int, rounds: int = 40) -> bool:
    d, r = n - 1, 0
    while d % 2 == 0:
        d, r = d // 2, r + 1
    for _ in range(rounds):
        x = pow(secrets.randbelow(n - 3) + 2, d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


class RsaKey:
    def __init__(self, bits: int = 2048) -> None:
        self.e = 65537
        while True:
            p, q = probable_prime(bits // 2), probable_prime(bits // 2)
            phi = (p - 1) * (q - 1)
            if p != q and phi % self.e:
                break
        self.n = p * q
        self.d = pow(self.e, -1, phi)
        self.size = (self.n.bit_length() + 7) // 8

    def sign_rs256(self, message: bytes) -> bytes:
        """RSASSA-PKCS1-v1_5 with SHA-256."""
        t = SHA256_DIGEST_INFO + hashlib.sha256(message).digest()
        encoded = b"\x00\x01" + b"\xff" * (self.size - len(t) - 3) + b"\x00" + t
        return pow(int.from_bytes(encoded, "big"), self.d, self.n).to_bytes(self.size, "big")

    def jwk(self) -> dict:
        return {"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "diff-key",
                "n": b64url(self.n.to_bytes(self.size, "big")), "e": b64url(self.e.to_bytes(3, "big"))}


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwt(key: RsaKey, claims: dict) -> str:
    header = b64url(json.dumps({"alg": "RS256", "typ": "JWT", "kid": "diff-key"}).encode())
    payload = b64url(json.dumps(claims).encode())
    signing_input = f"{header}.{payload}".encode()
    return f"{header}.{payload}.{b64url(key.sign_rs256(signing_input))}"


def claims_for(code: str, issuer: str) -> dict | None:
    now = int(time.time())
    base = {"iss": issuer, "aud": CLIENT_ID, "iat": now, "exp": now + 300}
    people = {
        "sample2": {"sub": "oidc-sample2", "email": "sample2@scm.io", "given_name": "Non-Admin", "family_name": "User"},
        "newuser": {"sub": "oidc-new", "email": "oidc-newuser@diff.test", "given_name": "Oidc", "family_name": "Newcomer"},
        "access-only": {"sub": "oidc-sample", "email": "sample@scm.io", "given_name": "Sample", "family_name": "User"},
        "bad-signature": {"sub": "oidc-bad", "email": "sample@scm.io", "given_name": "Bad", "family_name": "Key"},
        "expired": {"sub": "oidc-exp", "email": "sample@scm.io", "given_name": "Late", "family_name": "Token",
                    "iat": now - 7200, "exp": now - 3600},
        "no-email": {"sub": "oidc-noemail", "given_name": "No", "family_name": "Email"},
        "not-a-jwt": {"sub": "oidc-garbage", "email": "sample@scm.io", "given_name": "G", "family_name": "G"},
    }
    return {**base, **people[code]} if code in people else None


def make_handler(key: RsaKey, rogue_key: RsaKey, issuer: str, redirect_uri: str):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args) -> None:  # quiet; stack.py collects stdout
            pass

        def reply(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            path = urllib.parse.urlsplit(self.path).path
            if path == "/.well-known/openid-configuration":
                self.reply(200, {"issuer": issuer, "authorization_endpoint": f"{issuer}authorize",
                                 "token_endpoint": f"{issuer}token", "userinfo_endpoint": f"{issuer}userinfo",
                                 "jwks_uri": f"{issuer}jwks", "response_types_supported": ["code"],
                                 "id_token_signing_alg_values_supported": ["RS256"]})
            elif path == "/jwks":
                self.reply(200, {"keys": [key.jwk()]})
            elif path == "/health":
                self.reply(200, {"ok": True})
            else:
                self.reply(404, {"error": "not_found"})

        def do_POST(self) -> None:
            if urllib.parse.urlsplit(self.path).path != "/token":
                return self.reply(404, {"error": "not_found"})
            length = int(self.headers.get("Content-Length") or 0)
            form = {k: v[0] for k, v in urllib.parse.parse_qs(self.rfile.read(length).decode()).items()}
            expected_auth = "Basic " + base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
            if self.headers.get("Authorization") != expected_auth:
                return self.reply(401, {"error": "invalid_client"})
            if form.get("grant_type") != "authorization_code" or form.get("redirect_uri") != redirect_uri:
                return self.reply(400, {"error": "invalid_request", "error_description": "grant_type/redirect_uri"})
            code = form.get("code", "")
            claims = claims_for(code, issuer)
            if claims is None:
                return self.reply(400, {"error": "invalid_grant"})
            signer = rogue_key if code == "bad-signature" else key
            id_claims = {k: v for k, v in claims.items()}
            body = {"access_token": jwt(signer, claims), "token_type": "Bearer", "scope": form.get("scope")}
            if code == "not-a-jwt":
                body["access_token"] = "opaque-access-token"
            if code != "access-only":
                body["id_token"] = jwt(signer, id_claims) if code != "not-a-jwt" else "not.a.jwt"
            self.reply(200, body)

    return Handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", type=int, default=19589)
    parser.add_argument("--redirect-uri", required=True)
    args = parser.parse_args()
    issuer = f"http://127.0.0.1:{args.port}/"
    key, rogue_key = RsaKey(), RsaKey()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(key, rogue_key, issuer, args.redirect_uri))
    print(f"oidc mock on {issuer}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
