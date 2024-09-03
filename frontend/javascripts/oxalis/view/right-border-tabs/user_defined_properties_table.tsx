import { DeleteOutlined, TagsOutlined } from "@ant-design/icons";
import { Button, Input, type InputProps } from "antd";
import { type APIMetadataWithError, InnerMetadataTable } from "dashboard/folders/metadata_table";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import type { UserDefinedProperty } from "types/api_flow_types";

export function InputWithUpdateOnBlur({
  value,
  onChange,
  onBlur,
  ...props
}: { value: string; onChange: (value: string) => void } & Omit<InputProps, "onChange">) {
  const [localValue, setLocalValue] = useState(value);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        onChange(localValue);
      } else if (event.key === "Escape") {
        document.activeElement ? (document.activeElement as HTMLElement).blur() : null;
      }
      if (props.onKeyDown) {
        return props.onKeyDown(event);
      }
    },
    [onChange, props.onKeyDown, localValue],
  );

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <Input
      value={localValue}
      onBlur={(event) => {
        if (onBlur) onBlur(event);
        onChange(localValue);
      }}
      onChange={(event) => {
        setLocalValue(event.currentTarget.value);
      }}
      onKeyDown={onKeyDown}
      {...props}
    />
  );
}

export function UserDefinedPropertyTableRows<
  ItemType extends { userDefinedProperties: UserDefinedProperty[] },
>({
  item,
  updateUserDefinedPropertyByIndex,
}: {
  item: ItemType;
  updateUserDefinedPropertyByIndex: (
    item: ItemType,
    index: number,
    newPropPartial: Partial<UserDefinedProperty>,
  ) => void;
}) {
  // todop
  const isReadOnly = false;

  const getDeleteEntryButton = (_: APIMetadataWithError, _index: number) => (
    <div className="flex-center-child">
      <Button
        type="text"
        disabled={isReadOnly}
        style={{ width: 16, height: 19 }}
        icon={
          <DeleteOutlined
            style={{
              color: "var(--ant-color-text-tertiary)",
              width: 16,
            }}
          />
        }
        onClick={() => {
          // todop
        }}
      />
    </div>
  );

  // todop
  const getKeyInput = (record: APIMetadataWithError, index: number) => {
    return (
      <InputWithUpdateOnBlur
        className="transparent-input"
        // onFocus={() => setFocusedRow(index)}
        // onBlur={() => setFocusedRow(null)}
        value={record.key}
        onChange={(value) => updateUserDefinedPropertyByIndex(item, index, { key: value })}
        placeholder="Property"
        size="small"
        // disabled={isSaving}
        // id={getKeyInputIdForIndex(index)}
      />
    );
  };

  return (
    <>
      <tr className="divider-row">
        <td colSpan={3}>
          User-defined Properties <TagsOutlined />
        </td>
      </tr>
      ;
      {/*
            // todop
            export type APIMetadata = {
              type: APIMetadataType;
              key: string;
              value: string | number | string[];
            };*/}
      <InnerMetadataTable
        onlyReturnRows
        isVisualStudioTheme
        metadata={item.userDefinedProperties.map((prop) => ({
          key: prop.key,
          type: "string",
          value: prop.stringValue || "",
        }))}
        getKeyInput={getKeyInput}
        focusedRow={null}
        setFocusedRow={() => {}}
        updateMetadataValue={(indexToUpdate: number, newValue: number | string | string[]) => {
          updateUserDefinedPropertyByIndex(item, indexToUpdate, {
            stringValue: newValue as string,
          });
        }}
        isSaving={false}
        availableStrArrayTagOptions={[]}
        getDeleteEntryButton={getDeleteEntryButton}
        addNewEntryMenuItems={{}}
      />
    </>
  );
}
