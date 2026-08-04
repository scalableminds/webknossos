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

// Every bigint that ends up in a request payload to the backend is a segment/agglomerate id
// backed by the backend's UnsignedLong opaque type, which is (de)serialized via unsigned-decimal
// string encoding of the full 64-bit two's-complement bit pattern (mirroring Java's
// Long.toUnsignedString), regardless of whether the id is logically signed (e.g. a negative int32
// segment id) or unsigned (uint64). A plain value.toString() would emit the signed decimal
// representation instead (e.g. "-852176054"), which the backend's unsigned-decimal parser
// rejects. BigInt.asUintN(64, value) reinterprets the bit pattern as unsigned first, matching the
// backend exactly.
export function unsignedBigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? BigInt.asUintN(64, value).toString() : value;
}
