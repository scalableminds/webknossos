import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Flex, Form, Input } from "antd";
import { useEffect, useId, useRef, useState } from "react";

type JsonPrimitive = string | number | boolean;
export type KeyValuePairs = Record<string, JsonPrimitive>;

type KeyValueEntry = {
  id: string;
  key: string;
  rawValue: string; // always stored as string in the UI
};

function parseValue(raw: string): JsonPrimitive {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (raw !== "" && !Number.isNaN(n)) return n;
  return raw;
}

function entriesToPairs(entries: KeyValueEntry[]): KeyValuePairs {
  const result: KeyValuePairs = {};
  for (const { key, rawValue } of entries) {
    if (key !== "") {
      result[key] = parseValue(rawValue);
    }
  }
  return result;
}

function pairsToEntries(pairs: KeyValuePairs, idPrefix: string): KeyValueEntry[] {
  return Object.entries(pairs).map(([key, value], i) => ({
    id: `${idPrefix}-${i}`,
    key,
    rawValue: String(value),
  }));
}

// Stand-alone component (usable as a controlled antd FormItem child)
export function KeyValuePairsInput({
  value,
  onChange,
}: {
  // onChange and value should not be renamed, because these are the
  // default property names for controlled antd FormItems.
  value?: KeyValuePairs;
  onChange?: (pairs: KeyValuePairs) => void;
}) {
  const idPrefix = useId();
  // Internal state holds the full entry list including rows with empty keys that
  // are filtered out of the serialized value. This prevents newly-added rows from
  // disappearing immediately when the parent form re-renders with the filtered value.
  const [entries, setEntries] = useState<KeyValueEntry[]>(() =>
    pairsToEntries(value ?? {}, idPrefix),
  );
  // Track the last value we emitted so we can distinguish external value changes
  // (e.g. form reset) from echoes of our own onChange calls.
  const lastEmittedRef = useRef<string>(JSON.stringify(value ?? {}));

  useEffect(() => {
    const incoming = JSON.stringify(value ?? {});
    if (incoming !== lastEmittedRef.current) {
      lastEmittedRef.current = incoming;
      setEntries(pairsToEntries(value ?? {}, idPrefix));
    }
  }, [value]);

  function notify(next: KeyValueEntry[]) {
    setEntries(next);
    const pairs = entriesToPairs(next);
    lastEmittedRef.current = JSON.stringify(pairs);
    onChange?.(pairs);
  }

  function addEntry() {
    setEntries((prev) => [...prev, { id: `${idPrefix}-${Date.now()}`, key: "", rawValue: "" }]);
  }

  function removeEntry(id: string) {
    notify(entries.filter((e) => e.id !== id));
  }

  function updateEntry(id: string, patch: Partial<Omit<KeyValueEntry, "id">>) {
    notify(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  return (
    <Flex vertical gap="small">
      {entries.map((entry) => (
        <Flex key={entry.id} gap="small" align="center" style={{ width: "100%" }}>
          <Input
            placeholder="Key"
            value={entry.key}
            onChange={(e) => updateEntry(entry.id, { key: e.target.value })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Input
            placeholder="Value"
            value={entry.rawValue}
            onChange={(e) => updateEntry(entry.id, { rawValue: e.target.value })}
            style={{ flex: 1, minWidth: 0 }}
          />
          <Button
            type="text"
            danger
            icon={<DeleteOutlined />}
            onClick={() => removeEntry(entry.id)}
          />
        </Flex>
      ))}
      <div>
        <Button icon={<PlusOutlined />} onClick={addEntry} size="small">
          Add entry
        </Button>
      </div>
    </Flex>
  );
}

// Convenience Form.Item wrapper
export function KeyValuePairsFormItem({
  name,
  label,
  tooltip,
}: {
  name: string | Array<string | number>;
  label?: string;
  tooltip?: string;
}) {
  return (
    <Form.Item name={name} label={label ?? "Additional Parameters"} tooltip={tooltip}>
      <KeyValuePairsInput />
    </Form.Item>
  );
}
