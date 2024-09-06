import { CloseOutlined, TagsOutlined } from "@ant-design/icons";
import { Button } from "antd";
import {
  type APIMetadataWithError,
  getTypeSelectDropdownMenu,
  getUsedTagsWithinMetadata,
  InnerMetadataTable,
  MetadataValueInput,
} from "dashboard/folders/metadata_table";
import { type APIMetadata, APIMetadataEnum, type UserDefinedProperty } from "types/api_flow_types";
import { InputWithUpdateOnBlur } from "../components/input_with_update_on_blur";
import _ from "lodash";
import { memo } from "react";

const getKeyInputIdForIndex = (index: number) => `metadata-key-input-id-${index}`;

export const UserDefinedPropertyTableRows = memo(
  <ItemType extends { userDefinedProperties: UserDefinedProperty[] }>({
    item,
    setUserDefinedProperties,
  }: {
    item: ItemType;
    setUserDefinedProperties: (item: ItemType, newProperties: UserDefinedProperty[]) => void;
  }) => {
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

      if (
        newProps.some(
          (el) =>
            (el.stringValue != null && el.stringListValue != null) ||
            (el.stringListValue as any) === "" ||
            Array.isArray(el.stringValue),
        )
      ) {
        console.error("invalid newprops?");
        debugger;
      }

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

    const getKeyInput = (record: APIMetadataWithError, index: number) => {
      return (
        <div style={{ display: "flex" }}>
          <InputWithUpdateOnBlur
            prefix={<TagsOutlined />}
            className="transparent-input"
            value={record.key}
            onChange={(value) => updateUserDefinedPropertyByIndex(item, index, { key: value })}
            placeholder="Property"
            size="small"
            validate={(value: string) => {
              if (
                // If all items (except for the current one) have another key,
                // everything is fine.
                item.userDefinedProperties.every(
                  (otherItem, idx) => idx === index || otherItem.key !== value,
                )
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

    const itemMetadata = item.userDefinedProperties.map((prop) => ({
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
          updateMetadataValue={(
            indexToUpdate: number,
            newValue: number | string | string[],
            type: APIMetadataEnum,
          ) => {
            updateUserDefinedPropertyByIndex(item, indexToUpdate, {
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
      const indexOfNewEntry = item.userDefinedProperties.length;
      // Auto focus the key input of the new entry.
      setTimeout(
        () => document.getElementById(getKeyInputIdForIndex(indexOfNewEntry))?.focus(),
        50,
      );
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
        <InnerMetadataTable
          onlyReturnRows
          metadata={itemMetadata}
          getKeyInput={getKeyInput}
          getValueInput={getValueInput}
          getDeleteEntryButton={getDeleteEntryButton}
          addNewEntryMenuItems={addNewEntryMenuItems}
        />
      </>
    );
  },
);
