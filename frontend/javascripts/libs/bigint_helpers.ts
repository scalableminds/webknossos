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
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
