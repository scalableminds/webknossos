import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { JsonPrimitive } from "admin/api/jobs";
import { AutoComplete, Button, Flex, Form, Input } from "antd";
import useDidMount from "beautiful-react-hooks/useDidMount";
import importWithRetry, { DynamicImportError } from "libs/import_with_retry";
import Toast from "libs/toast";
import { useId, useState } from "react";

export type KeyValuePairs = Record<string, JsonPrimitive>;

type KeyValueEntry = {
  id: string;
  key: string;
  rawValue: string;
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

/**
 * An editable list of key-value pairs whose result is a JSON-serializable object.
 * Values are entered as plain text and automatically coerced to numbers or booleans
 * where applicable (e.g. "42" → 42, "true" → true). Keys support autocomplete from
 * the known workflow config keys.
 *
 * Designed to be embedded in an antd Form.Item — the `onChange` prop is called with
 * the current pairs whenever the list changes.
 */
export function KeyValuePairsInput({
  onChange,
}: {
  // onChange should not be renamed — it is the default prop name for controlled antd FormItems.
  onChange?: (pairs: KeyValuePairs) => void;
}) {
  const idPrefix = useId();
  const [entries, setEntries] = useState<KeyValueEntry[]>([]);
  const [configKeyOptions, setConfigKeyOptions] = useState<{ value: string }[]>([]);

  useDidMount(() => {
    importWithRetry(() => import("viewer/view/ai_jobs/workflow_config_keys"), {
      showErrorToast: false,
    })
      .then(({ WORKFLOW_CONFIG_KEYS }) => {
        setConfigKeyOptions(WORKFLOW_CONFIG_KEYS.map((k) => ({ value: k })));
      })
      .catch((error) => {
        if (!(error instanceof DynamicImportError)) return;
        if (error.reason === "new-version") {
          Toast.info(
            "Workflow key autocompletion is unavailable. A new WEBKNOSSOS version was released – please reload.",
          );
        } else {
          Toast.warning(
            "Workflow key autocompletion could not be loaded due to a network problem.",
          );
        }
      });
  });

  function addEntry() {
    setEntries((prev) => [...prev, { id: `${idPrefix}-${Date.now()}`, key: "", rawValue: "" }]);
  }

  function removeEntry(id: string) {
    const newEntries = entries.filter((e) => e.id !== id);
    setEntries(newEntries);
    onChange?.(entriesToPairs(newEntries));
  }

  function updateEntry(id: string, patch: Partial<Omit<KeyValueEntry, "id">>) {
    const newEntries = entries.map((e) => (e.id === id ? { ...e, ...patch } : e));
    setEntries(newEntries);
    onChange?.(entriesToPairs(newEntries));
  }

  return (
    <Flex vertical gap="small">
      {entries.map((entry) => (
        <Flex key={entry.id} gap="small" align="center" style={{ width: "100%" }}>
          <AutoComplete
            placeholder="Key"
            value={entry.key}
            options={configKeyOptions}
            showSearch={{
              filterOption: (input, option) =>
                (option?.value ?? "").toLowerCase().includes(input.toLowerCase()),
            }}
            onChange={(value) => updateEntry(entry.id, { key: value })}
            style={{ flex: 1 }}
            popupMatchSelectWidth={false}
          />
          <Input
            placeholder="Value"
            value={entry.rawValue}
            onChange={(e) => updateEntry(entry.id, { rawValue: e.target.value })}
            style={{ flex: 1 }}
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
