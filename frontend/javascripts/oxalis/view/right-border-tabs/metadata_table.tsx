import { CloseOutlined, TagsOutlined } from "@ant-design/icons";
import { Button } from "antd";
import {
  type APIMetadataWithError,
  getTypeSelectDropdownMenu,
  getUsedTagsWithinMetadata,
  InnerMetadataTable,
  MetadataValueInput,
} from "dashboard/folders/metadata_table";
import { type APIMetadata, APIMetadataEnum, type MetadataEntry } from "types/api_flow_types";
import { InputWithUpdateOnBlur } from "../components/input_with_update_on_blur";
import _ from "lodash";
import { memo } from "react";

const getKeyInputIdForIndex = (index: number) => `metadata-key-input-id-${index}`;

function _MetadataTableRows<ItemType extends { metadata: MetadataEntry[] }>({
  item,
  setMetadata,
  readOnly,
}: {
  item: ItemType;
  setMetadata: (item: ItemType, newProperties: MetadataEntry[]) => void;
  readOnly: boolean;
}) {
  const updateMetadataEntryByIndex = (
    item: ItemType,
    index: number,
    newPropPartial: Partial<MetadataEntry>,
  ) => {
    if (readOnly) {
      return;
    }
    const newProps = item.metadata.map((element, idx) =>
      idx === index
        ? {
            ...element,
            ...newPropPartial,
          }
        : element,
    );

    // todop: remove again?
    if (
      newProps.some(
        (el) =>
          (el.stringValue != null && el.stringListValue != null) ||
          (el.stringListValue as any) === "" ||
          Array.isArray(el.stringValue),
      )
    ) {
      console.error("invalid newprops?");
    }

    setMetadata(item, newProps);
  };

  const removeMetadataEntryByIndex = (item: ItemType, index: number) => {
    const newProps = item.metadata.filter((_element, idx) => idx !== index);
    setMetadata(item, newProps);
  };

  const addMetadataEntry = (item: ItemType, newProp: MetadataEntry) => {
    const newProps = item.metadata.concat([newProp]);
    setMetadata(item, newProps);
  };

  const getDeleteEntryButton = (_: APIMetadataWithError, index: number) => (
    <div className="flex-center-child">
      <Button
        type="text"
        disabled={readOnly}
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
          removeMetadataEntryByIndex(item, index);
        }}
      />
    </div>
  );

  const getKeyInput = (record: APIMetadataWithError, index: number) => {
    return (
      <div style={{ display: "flex" }}>
        <InputWithUpdateOnBlur
          prefix={<TagsOutlined />}
          className="transparent-input"
          value={record.key}
          disabled={readOnly}
          onChange={(value) => updateMetadataEntryByIndex(item, index, { key: value })}
          placeholder="Property"
          size="small"
          validate={(value: string) => {
            if (
              // If all items (except for the current one) have another key,
              // everything is fine.
              item.metadata.every((otherItem, idx) => idx === index || otherItem.key !== value)
            ) {
              return null;
            }
            return "Each key must be unique and can only be used once.";
          }}
          id={getKeyInputIdForIndex(index)}
        />
      </div>
    );
  };

  const itemMetadata = item.metadata.map((prop) => ({
    key: prop.key,
    type:
      prop.stringValue != null
        ? APIMetadataEnum.STRING
        : prop.numberValue != null
          ? APIMetadataEnum.NUMBER
          : APIMetadataEnum.STRING_ARRAY,
    value: prop.stringValue || prop.numberValue || prop.stringListValue || "",
  }));

  const getValueInput = (record: APIMetadataWithError, index: number) => {
    return (
      <MetadataValueInput
        record={record}
        index={index}
        readOnly={readOnly}
        updateMetadataValue={(
          indexToUpdate: number,
          newValue: number | string | string[],
          type: APIMetadataEnum,
        ) => {
          updateMetadataEntryByIndex(item, indexToUpdate, {
            stringValue: type === APIMetadataEnum.STRING ? (newValue as string) : undefined,
            stringListValue:
              type === APIMetadataEnum.STRING_ARRAY ? (newValue as string[]) : undefined,
            numberValue: type === APIMetadataEnum.NUMBER ? (newValue as number) : undefined,
            // todop: support bool?
          });
        }}
        availableStrArrayTagOptions={getUsedTagsWithinMetadata(itemMetadata)}
      />
    );
  };

  const addNewEntryWithType = (type: APIMetadata["type"]) => {
    const indexOfNewEntry = item.metadata.length;
    // Auto focus the key input of the new entry.
    setTimeout(() => document.getElementById(getKeyInputIdForIndex(indexOfNewEntry))?.focus(), 50);
    addMetadataEntry(item, {
      key: "",
      stringValue: type === APIMetadataEnum.STRING ? "" : undefined,
      numberValue: type === APIMetadataEnum.NUMBER ? 0 : undefined,
      stringListValue: type === APIMetadataEnum.STRING_ARRAY ? [] : undefined,
    });
  };

  const addNewEntryMenuItems = getTypeSelectDropdownMenu(addNewEntryWithType);

  return (
    <>
      <InnerMetadataTable
        onlyReturnRows
        metadata={itemMetadata}
        getKeyInput={getKeyInput}
        getValueInput={getValueInput}
        getDeleteEntryButton={getDeleteEntryButton}
        addNewEntryMenuItems={addNewEntryMenuItems}
        readOnly={readOnly}
      />
    </>
  );
}

export const MetadataEntryTableRows = memo(_MetadataTableRows) as typeof _MetadataTableRows;