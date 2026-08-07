// Converts a JSON-decoded segment/agglomerate id into a bigint. Accepts both the new
// unsigned-decimal string encoding and the legacy plain-number encoding (permanent
// backward compatibility, since old update actions are persisted indefinitely and
// replayed for undo/redo/history) — BigInt() already parses both forms natively.
export function toBigInt(raw: string | number | bigint): bigint {
  return typeof raw === "bigint" ? raw : BigInt(raw);
}

// JSON.stringify throws on a raw bigint ("Do not know how to serialize a BigInt").
// This replacer makes every outgoing JSON.stringify call safe without requiring each
// call site to remember to convert bigint ids beforehand.
// Only use this for local/human-facing serialization (URL state, debug dumps) that is
// parsed back by the frontend itself. For requests sent to the backend, use
// unsignedBigIntReplacer instead (see below).
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// Tag used by the backend's UnsignedLongJson to mark a self-describing bigint envelope, e.g.
// { _customEncoding: "bigint", value: "3" }, instead of a plain JsString -- a plain string can't
// be distinguished from an ordinary string field without this tag. Shared by the replacer
// (below) and the reviver in libs/request.ts so both sides agree on the exact shape.
const CUSTOM_ENCODING_KEY = "_customEncoding";
const BIGINT_ENCODING_NAME = "bigint";

// Every bigint that ends up in a request payload to the backend is a segment/agglomerate id
// backed by the backend's UnsignedLong opaque type, which is (de)serialized via an unsigned-
// decimal envelope (see CUSTOM_ENCODING_KEY above) representing the full 64-bit two's-complement
// bit pattern (mirroring Java's Long.toUnsignedString), regardless of whether the id is logically
// signed (e.g. a negative int32 segment id) or unsigned (uint64). A plain value.toString() would
// emit the signed decimal representation instead (e.g. "-852176054"), which the backend's
// unsigned-decimal parser rejects. BigInt.asUintN(64, value) reinterprets the bit pattern as
// unsigned first, matching the backend exactly.
export function unsignedBigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value !== "bigint") {
    return value;
  }
  return {
    [CUSTOM_ENCODING_KEY]: BIGINT_ENCODING_NAME,
    value: BigInt.asUintN(64, value).toString(),
  };
}

// Mirrors unsignedBigIntReplacer: recognizes the { _customEncoding: "bigint", value: "..." }
// envelope anywhere in a JSON.parse'd response tree and converts it back into a real bigint, so
// individual call sites never need to manually convert a known id field after receiving a
// response (see JSON.parse's reviver parameter, which is passed this function in libs/request.ts).
export function bigIntReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)[CUSTOM_ENCODING_KEY] === BIGINT_ENCODING_NAME &&
    typeof (value as Record<string, unknown>).value === "string"
  ) {
    return BigInt((value as Record<string, unknown>).value as string);
  }
  return value;
}
