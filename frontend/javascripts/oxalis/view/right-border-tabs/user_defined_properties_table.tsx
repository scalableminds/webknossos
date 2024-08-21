import { TagsOutlined } from "@ant-design/icons";
import React, { useEffect, useState } from "react";
import type { UserDefinedProperty } from "types/api_flow_types";

export function InputWithUpdateOnBlur({
  value,
  onChange,
}: { value: string; onChange: (value: string) => void }) {
  const [localValue, setLocalValue] = useState(value);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <input
      type="text"
      value={localValue}
      onBlur={() => onChange(localValue)}
      onChange={(event) => {
        setLocalValue(event.currentTarget.value);
      }}
    />
  );
}

export function UserDefinedTableRows({
  userDefinedProperties,
  onChange,
}: {
  userDefinedProperties: UserDefinedProperty[] | null;
  onChange: (oldKey: string, propPartial: Partial<UserDefinedProperty>) => void;
}) {
  if (userDefinedProperties == null || userDefinedProperties.length === 0) {
    return null;
  }
  return (
    <>
      <tr className={"divider-row"}>
        <td colSpan={2}>
          User-defined Properties <TagsOutlined />
        </td>
      </tr>
      {userDefinedProperties.map((prop) => (
        <tr key={prop.key}>
          <td>
            <InputWithUpdateOnBlur
              value={prop.key}
              onChange={(newKey) =>
                onChange(prop.key, {
                  key: newKey,
                })
              }
            />
          </td>

          <td>
            <InputWithUpdateOnBlur
              value={prop.stringValue || ""}
              onChange={(newValue) => {
                onChange(prop.key, {
                  stringValue: newValue,
                });
              }}
            />
          </td>
        </tr>
      ))}
    </>
  );
}
