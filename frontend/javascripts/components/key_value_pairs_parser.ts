import type { JsonPrimitive, JsonValue } from "admin/api/jobs";

const QUOTE_CHARS = ['"', "'"];

// A value may be a single primitive, a list of primitives or a list of primitive groups
// (e.g. coordinates or bounding boxes). Anything nested deeper is rejected.
const MAX_LIST_DEPTH = 2;

/** Returns the quote character the text is wrapped in, if any. */
function getWrappingQuote(trimmed: string): string | undefined {
  return QUOTE_CHARS.find(
    (char) => trimmed.length >= 2 && trimmed.startsWith(char) && trimmed.endsWith(char),
  );
}

/**
 * Coerces a raw text token to a boolean, number or string where applicable
 * (e.g. "42" → 42, "true" → true). Wrapping a token in quotes keeps it a string
 * (e.g. '"42"' → "42").
 */
export function parsePrimitive(raw: string): JsonPrimitive {
  const trimmed = raw.trim();
  const quote = getWrappingQuote(trimmed);
  if (quote != null) return trimmed.slice(1, -1);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const asNumber = Number(trimmed);
  if (trimmed !== "" && !Number.isNaN(asNumber)) return asNumber;
  return raw;
}

/**
 * Splits text at top-level commas, i.e. commas that are neither nested in a bracketed
 * group nor part of a quoted string. Returns null for unbalanced input.
 */
function splitTopLevel(text: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let openQuote: string | null = null;

  for (const char of text) {
    if (openQuote != null) {
      if (char === openQuote) openQuote = null;
    } else if (QUOTE_CHARS.includes(char)) {
      openQuote = char;
    } else if (char === "[") {
      depth++;
    } else if (char === "]") {
      depth--;
      if (depth < 0) return null;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (depth !== 0 || openQuote != null) return null;
  parts.push(current);
  return parts;
}

/** Parses the comma-separated items of a list. Returns null if any item is malformed. */
function parseItems(parts: string[], depth: number): JsonValue[] | null {
  // Tolerate a single trailing comma, e.g. "1, 2, ".
  const items =
    parts.length > 1 && parts[parts.length - 1].trim() === "" ? parts.slice(0, -1) : parts;

  const parsedItems: JsonValue[] = [];
  for (const item of items) {
    const token = item.trim();
    if (token === "") return null;
    if (token.startsWith("[")) {
      const nested = parseList(token, depth + 1);
      if (nested == null) return null;
      parsedItems.push(nested);
    } else {
      parsedItems.push(parsePrimitive(token));
    }
  }
  return parsedItems;
}

/**
 * Parses bracket notation such as "[1, 2, 3]" or "[[0, 0, 0], [10, 10, 10]]" into a list.
 * Returns null if the text is not a well-formed list of the supported depth.
 */
function parseList(raw: string, depth: number): JsonValue[] | null {
  const trimmed = raw.trim();
  if (depth > MAX_LIST_DEPTH) return null;
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]") || trimmed.length < 2) return null;

  const inner = trimmed.slice(1, -1);
  if (inner.trim() === "") return [];

  const parts = splitTopLevel(inner);
  if (parts == null) return null;
  return parseItems(parts, depth);
}

/**
 * Parses a list that is not wrapped in brackets, such as "1, 2, 3" or
 * "[0, 0, 0], [10, 10, 10]". Returns null if the text holds no top-level comma
 * (i.e. it is a single value) or if it is malformed.
 */
function parseBareList(raw: string): JsonValue[] | null {
  const trimmed = raw.trim();
  if (getWrappingQuote(trimmed) != null) return null;

  const parts = splitTopLevel(trimmed);
  if (parts == null || parts.length < 2) return null;
  return parseItems(parts, 1);
}

/**
 * Parses the raw text of a value input. Comma-separated text and bracket notation yield
 * a list (of lists), anything else is coerced to a single primitive.
 */
export function parseValue(raw: string): JsonValue {
  return parseList(raw, 1) ?? parseBareList(raw) ?? parsePrimitive(raw);
}

/** True if the text looks like a list but could not be parsed as one. */
export function isMalformedList(raw: string): boolean {
  const trimmed = raw.trim();
  if (getWrappingQuote(trimmed) != null) return false;
  const looksLikeList = trimmed.startsWith("[") || trimmed.includes(",");
  return looksLikeList && !Array.isArray(parseValue(raw));
}
