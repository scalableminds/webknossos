import { CloseOutlined, TagsOutlined } from "@ant-design/icons";
import { Button, Checkbox } from "antd";
import FastTooltip from "components/fast_tooltip";
import {
  type APIMetadataWithError,
  getTypeSelectDropdownMenu,
  getUsedTagsWithinMetadata,
  InnerMetadataTable,
  MetadataValueInput,
} from "dashboard/folders/metadata_table";
import { memo } from "react";
import { type APIMetadataEntry, APIMetadataEnum, type MetadataEntryProto } from "types/api_types";
import { InputWithUpdateOnBlur } from "../components/input_with_update_on_blur";

function isBoolMetadataEntry(prop: MetadataEntryProto): boolean {
  return (
    prop.boolValue != null &&
    prop.stringValue == null &&
    prop.numberValue == null &&
    (prop.stringListValue == null || prop.stringListValue.length === 0)
  );
}

export function toAPIMetadataEntry(prop: MetadataEntryProto): APIMetadataEntry {
  if (prop.stringValue != null) {
    return { key: prop.key, type: APIMetadataEnum.STRING, value: prop.stringValue };
  }
  if (prop.numberValue != null) {
    return { key: prop.key, type: APIMetadataEnum.NUMBER, value: prop.numberValue };
  }
  if (isBoolMetadataEntry(prop)) {
    // There is no boolean type for the shared metadata table. The value is
    // rendered as a checkbox instead (see getValueInput).
    return { key: prop.key, type: APIMetadataEnum.STRING, value: String(prop.boolValue) };
  }
  return { key: prop.key, type: APIMetadataEnum.STRING_ARRAY, value: prop.stringListValue ?? [] };
}

const getKeyInputIdForIndex = (index: number) => `metadata-key-input-id-${index}`;

function MetadataTableRowsInner<ItemType extends { metadata: MetadataEntryProto[] }>({
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
        icon={<CloseOutlined />}
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

  const itemMetadata = item.metadata.map(toAPIMetadataEntry);

  const getValueInput = (entry: APIMetadataWithError, index: number) => {
    const prop = item.metadata[index];
    if (prop != null && isBoolMetadataEntry(prop)) {
      // Boolean entries only exist in annotations (e.g., imported from NML) and
      // are not supported by the shared metadata value input.
      return (
        <Checkbox
          checked={prop.boolValue}
          disabled={readOnly}
          onChange={(event) =>
            updateMetadataEntryByIndex(item, index, { boolValue: event.target.checked })
          }
        />
      );
    }
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
    <InnerMetadataTable
      onlyReturnRows
      metadata={itemMetadata}
      getKeyInput={getKeyInput}
      getValueInput={getValueInput}
      getDeleteEntryButton={getDeleteEntryButton}
      addNewEntryMenuItems={addNewEntryMenuItems}
      readOnly={readOnly}
    />
  );
}

export const MetadataEntryTableRows = memo(MetadataTableRowsInner) as typeof MetadataTableRowsInner;
