import { CloseOutlined, TagsOutlined } from "@ant-design/icons";
import { Button, Input, type InputProps } from "antd";
import {
  type APIMetadataWithError,
  getTypeSelectDropdownMenu,
  InnerMetadataTable,
} from "dashboard/folders/metadata_table";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { type APIMetadata, APIMetadataEnum, type UserDefinedProperty } from "types/api_flow_types";

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
  setUserDefinedProperties,
}: {
  item: ItemType;
  setUserDefinedProperties: (item: ItemType, newProperties: UserDefinedProperty[]) => void;
}) {
  // todop
  const isReadOnly = false;

  const updateUserDefinedPropertyByIndex = (
    item: ItemType,
    index: number,
    newPropPartial: Partial<UserDefinedProperty>,
  ) => {
    const newProps = item.userDefinedProperties.map((element, idx) =>
      idx === index
        ? {
            ...element,
            ...newPropPartial,
          }
        : element,
    );

    setUserDefinedProperties(item, newProps);
  };

  const removeUserDefinedPropertyByIndex = (item: ItemType, index: number) => {
    const newProps = item.userDefinedProperties.filter((_element, idx) => idx !== index);
    setUserDefinedProperties(item, newProps);
  };

  const addUserDefinedProperty = (item: ItemType, newProp: UserDefinedProperty) => {
    const newProps = item.userDefinedProperties.concat([newProp]);
    setUserDefinedProperties(item, newProps);
  };

  const getDeleteEntryButton = (_: APIMetadataWithError, index: number) => (
    <div className="flex-center-child">
      <Button
        type="text"
        disabled={isReadOnly}
        style={{ width: 16, height: 19 }}
        icon={
          <CloseOutlined
            style={{
              color: "var(--ant-color-text-tertiary)",
              width: 16,
            }}
          />
        }
        onClick={() => {
          removeUserDefinedPropertyByIndex(item, index);
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

  const addNewEntryWithType = (type: APIMetadata["type"]) => {
    // const indexOfNewEntry = prev.length;
    // Auto focus the key input of the new entry.
    // setTimeout(
    //   () => document.getElementById(getKeyInputIdForIndex(indexOfNewEntry))?.focus(),
    //   50,
    // );
    addUserDefinedProperty(item, {
      key: "",
      stringValue: type === APIMetadataEnum.STRING ? "" : undefined,
      numberValue: type === APIMetadataEnum.NUMBER ? 0 : undefined,
      stringListValue: type === APIMetadataEnum.STRING_ARRAY ? [] : undefined,
    });
  };

  const addNewEntryMenuItems = getTypeSelectDropdownMenu(addNewEntryWithType);

  return (
    <>
      <tr className="divider-row">
        <td colSpan={3}>
          User-defined Properties <TagsOutlined />
        </td>
      </tr>
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
        addNewEntryMenuItems={addNewEntryMenuItems}
      />
    </>
  );
}
