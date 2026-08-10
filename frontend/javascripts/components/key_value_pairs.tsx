import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import type { JsonValue } from "admin/api/jobs";
import { AutoComplete, Button, Flex, Form, Input, Typography } from "antd";
import useDidMount from "beautiful-react-hooks/useDidMount";
import { isMalformedList, parseValue } from "components/key_value_pairs_parser";
import importDynamic, { DynamicImportError } from "libs/import_dynamic";
import Toast from "libs/toast";
import { useId, useState } from "react";

export type KeyValuePairs = Record<string, JsonValue>;

export const LIST_VALUE_HINT =
  "Values are interpreted as numbers or booleans where applicable. Enter a list as comma-separated values, e.g. 1, 2, 3 – and a list of coordinate groups with brackets, e.g. [0, 0, 0], [10, 10, 10]. Wrap a value in quotes to keep commas as plain text.";

type KeyValueEntry = {
  id: string;
  key: string;
  rawValue: string;
};

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
 * where applicable (e.g. "42" → 42, "true" → true). Comma-separated text yields a list of
 * values ("1, 2, 3") or a list of value groups ("[0, 0, 0], [10, 10, 10]").
 * Keys support autocomplete from the known workflow config keys.
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

  useDidMount(async () => {
    try {
      const { WORKFLOW_CONFIG_KEYS } = await importDynamic(
        () => import("viewer/view/ai_jobs/workflow_config_keys"),
        {
          showErrorToast: false,
        },
      );
      setConfigKeyOptions(WORKFLOW_CONFIG_KEYS.map((k) => ({ value: k })));
    } catch (error) {
      // If the error has nothing to do with imports failing, propagate the error further upwards.
      if (!(error instanceof DynamicImportError)) throw error;
      if (error.reason === "new-version-available") {
        Toast.info(
          "Workflow key autocompletion is unavailable. A new WEBKNOSSOS version was released – please reload.",
        );
      } else {
        Toast.warning("Workflow key autocompletion could not be loaded due to a network problem.");
      }
    }
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
      {entries.map((entry) => {
        const hasMalformedList = isMalformedList(entry.rawValue);
        return (
          <Flex key={entry.id} vertical gap={4} style={{ width: "100%" }}>
            <Flex gap="small" align="center">
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
                placeholder="Value, e.g. 42 or 1, 2, 3"
                value={entry.rawValue}
                status={hasMalformedList ? "warning" : undefined}
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
            {hasMalformedList ? (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>
                This is not a valid list and will be sent as text. Expected e.g. 1, 2, 3 or [0, 0,
                0], [10, 10, 10].
              </Typography.Text>
            ) : null}
          </Flex>
        );
      })}
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
    <Form.Item
      name={name}
      label={label ?? "Additional Parameters"}
      tooltip={tooltip ?? LIST_VALUE_HINT}
    >
      <KeyValuePairsInput />
    </Form.Item>
  );
}
