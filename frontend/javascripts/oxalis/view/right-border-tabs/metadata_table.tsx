import { CloseOutlined, TagsOutlined } from "@ant-design/icons";
import { Button } from "antd";
import {
  type APIMetadataWithError,
  getTypeSelectDropdownMenu,
  getUsedTagsWithinMetadata,
  InnerMetadataTable,
  MetadataValueInput,
} from "dashboard/folders/metadata_table";
import {
  type APIMetadataEntry,
  APIMetadataEnum,
  type MetadataEntryProto,
} from "types/api_flow_types";
import { InputWithUpdateOnBlur } from "../components/input_with_update_on_blur";
import { memo } from "react";
import FastTooltip from "components/fast_tooltip";

const getKeyInputIdForIndex = (index: number) => `metadata-key-input-id-${index}`;

function _MetadataTableRows<ItemType extends { metadata: MetadataEntryProto[] }>({
  item,
  setMetadata,
  readOnly,
}: {
  item: ItemType;
  setMetadata: (item: ItemType, newProperties: MetadataEntryProto[]) => void;
  readOnly: boolean;
}) {
  const updateMetadataEntryByIndex = (
    item: ItemType,
    index: number,
    newPropPartial: Partial<MetadataEntryProto>,
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

    setMetadata(item, newProps);
  };

  const removeMetadataEntryByIndex = (item: ItemType, index: number) => {
    const newProps = item.metadata.filter((_element, idx) => idx !== index);
    setMetadata(item, newProps);
  };

  const addMetadataEntry = (item: ItemType, newProp: MetadataEntryProto) => {
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

  const getKeyInput = (entry: APIMetadataWithError, index: number) => {
    return (
      <div style={{ display: "flex" }}>
        <InputWithUpdateOnBlur
          prefix={
            <FastTooltip title="This is a user-defined metadata property that consists of a key and a value.">
              <TagsOutlined />
            </FastTooltip>
          }
          className="transparent-input"
          value={entry.key}
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

  const getValueInput = (entry: APIMetadataWithError, index: number) => {
    return (
      <MetadataValueInput
        entry={entry}
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
          });
        }}
        availableStrArrayTagOptions={getUsedTagsWithinMetadata(itemMetadata)}
      />
    );
  };

  const addNewEntryWithType = (type: APIMetadataEntry["type"]) => {
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
