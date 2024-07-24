import {
  DeleteOutlined,
  FieldNumberOutlined,
  FieldStringOutlined,
  PlusOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import {
  MenuProps,
  InputNumberProps,
  InputNumber,
  Input,
  Select,
  Typography,
  Dropdown,
  Button,
} from "antd";
import { useWillUnmount } from "beautiful-react-hooks";
import {
  DatasetCollectionContextValue,
  useDatasetCollectionContext,
} from "dashboard/dataset/dataset_collection_context";
import { useEffectOnUpdate } from "libs/react_hooks";
import _ from "lodash";
import React from "react";
import { useState, useEffect } from "react";
import {
  APIDataset,
  Folder,
  APIMetadataEntries,
  APIMetadata,
  APIMetadataType,
} from "types/api_flow_types";

function metadataTypeToString(type: APIMetadata["type"]) {
  switch (type) {
    case "string":
      return (
        <span>
          <FieldStringOutlined /> Text
        </span>
      );
    case "number":
      return (
        <span>
          <FieldNumberOutlined /> Number
        </span>
      );
    case "string[]":
      return (
        <span>
          <TagsOutlined /> Multi-Item Text
        </span>
      );
  }
}

let isDatasetUpdatePending = false;
const updateCachedDatasetOrFolderDebounced = _.debounce(
  async (
    context: DatasetCollectionContextValue,
    selectedDatasetOrFolder: APIDataset | Folder,
    metadata: APIMetadataEntries,
  ) => {
    isDatasetUpdatePending = false;
    if ("folderId" in selectedDatasetOrFolder) {
      // In case of a dataset, update the dataset's metadata.
      await context.updateCachedDataset(selectedDatasetOrFolder, { metadata: metadata });
    } else {
      // Else update the folders metadata.
      const folder = selectedDatasetOrFolder;
      await context.queries.updateFolderMutation.mutateAsync({
        ...folder,
        allowedTeams: folder.allowedTeams?.map((t) => t.id) || [],
        metadata,
      });
    }
  },
  3000,
);
const originalFlush = updateCachedDatasetOrFolderDebounced.flush;
// Overwrite the debounce flush function to avoid flushing when no update is pending.
updateCachedDatasetOrFolderDebounced.flush = async () => {
  if (!isDatasetUpdatePending) return;
  isDatasetUpdatePending = false;
  originalFlush();
};
function updateCachedDatasetOrFolderDebouncedTracked(
  context: DatasetCollectionContextValue,
  selectedDatasetOrFolder: APIDataset | Folder,
  metadata: APIMetadataEntries,
) {
  isDatasetUpdatePending = true;
  updateCachedDatasetOrFolderDebounced(context, selectedDatasetOrFolder, metadata);
  return updateCachedDatasetOrFolderDebounced;
}

type APIMetadataWithIndex = APIMetadata & { index: number };
type IndexedMetadataEntries = APIMetadataWithIndex[];

export default function MetadataTable({
  selectedDatasetOrFolder,
}: { selectedDatasetOrFolder: APIDataset | Folder }) {
  const context = useDatasetCollectionContext();
  const [metadata, setMetadata] = useState<IndexedMetadataEntries>(
    selectedDatasetOrFolder?.metadata?.map((entry, index) => ({ ...entry, index })) || [],
  );
  const [error, setError] = useState<[number, string] | null>(null); // [index, error message]
  const [focusedRow, setFocusedRow] = useState<number | null>(null);

  useEffect(() => {
    if (isDatasetUpdatePending) {
      // Flush pending updates and wait for the next update to update this components metadata.
      // Otherwise, a cyclic update race between the selectedDatasetOrFolder.metadata and the flushed version might occur.
      updateCachedDatasetOrFolderDebounced.flush();
    } else {
      // Update state to newest metadata from selectedDatasetOrFolder.
      setMetadata(
        selectedDatasetOrFolder.metadata?.map((entry, index) => ({ ...entry, index })) || [],
      );
    }
  }, [selectedDatasetOrFolder.metadata]);

  useEffectOnUpdate(() => {
    if (error == null) {
      const metadataWithoutIndex = metadata.map(({ index: _ignored, ...rest }) => rest);
      updateCachedDatasetOrFolderDebouncedTracked(
        context,
        selectedDatasetOrFolder,
        metadataWithoutIndex,
      );
    }
  }, [metadata, error]);

  // On component unmount flush pending updates to avoid potential data loss.
  useWillUnmount(() => {
    updateCachedDatasetOrFolderDebounced.flush();
  });

  const updatePropName = (index: number, newPropName: string) => {
    setMetadata((prev) => {
      const entry = prev.find((prop) => prop.index === index);
      if (!entry) {
        return prev;
      }
      const maybeAlreadyExistingEntry = prev.find((prop) => prop.key === newPropName);
      if (maybeAlreadyExistingEntry) {
        setError([entry?.index || -1, `Property ${newPropName} already exists.`]);
      } else {
        setError(null);
      }
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      return [
        ...detailsWithoutEditedEntry,
        {
          ...entry,
          key: newPropName,
        },
      ];
    });
  };

  const updateValue = (index: number, newValue: number | string | string[]) => {
    setMetadata((prev) => {
      const entry = prev.find((prop) => prop.index === index);
      if (!entry) {
        return prev;
      }
      const updatedEntry = { ...entry, value: newValue };
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      return [...detailsWithoutEditedEntry, updatedEntry];
    });
  };

  const addType = (type: APIMetadata["type"]) => {
    setMetadata((prev) => {
      const highestIndex = prev.reduce((acc, curr) => Math.max(acc, curr.index), 0);
      const newEntry: APIMetadataWithIndex = {
        key: "",
        value:
          type === APIMetadataType.STRING_ARRAY ? [] : type === APIMetadataType.NUMBER ? 0 : "",
        index: highestIndex + 1,
        type,
      };
      return [...prev, newEntry];
    });
  };

  const deleteKey = (index: number) => {
    setMetadata((prev) => {
      return prev.filter((prop) => prop.index !== index);
    });
  };

  const sortedDetails = metadata.sort((a, b) => a.index - b.index);

  const availableStrArrayTagOptions = _.uniq(
    sortedDetails.flatMap((detail) => (detail.type === "string[]" ? detail.value : [])),
  ).map((tag) => ({ value: tag, label: tag }));

  const getTypeSelectDropdownMenu: () => MenuProps = () => ({
    items: Object.values(APIMetadataType).map((type) => {
      return {
        key: type,
        label: metadataTypeToString(type as APIMetadata["type"]),
        onClick: () => addType(type as APIMetadata["type"]),
      };
    }),
  });

  const getValueInput = (record: APIMetadataWithIndex) => {
    const isFocused = record.index === focusedRow;
    const sharedProps = {
      className: isFocused ? undefined : "transparent-input",
      onFocus: () => setFocusedRow(record.index),
      onBlur: () => setFocusedRow(null),
      placeholder: "Value",
      size: "small" as InputNumberProps<number>["size"],
    };
    switch (record.type) {
      case "number":
        return (
          <InputNumber
            value={record.value as number}
            onChange={(newNum) => updateValue(record.index, newNum || 0)}
            {...sharedProps}
          />
        );
      case "string":
        return (
          <Input
            value={record.value}
            onChange={(evt) => updateValue(record.index, evt.target.value)}
            {...sharedProps}
          />
        );
      case "string[]":
        return (
          <Select
            mode="tags"
            value={record.value as string[]}
            onChange={(values) => updateValue(record.index, values)}
            options={availableStrArrayTagOptions}
            suffixIcon={null}
            {...sharedProps}
          />
        );
      default:
        return null;
    }
  };

  const getKeyInput = (record: APIMetadataWithIndex) => {
    const isFocused = record.index === focusedRow;
    return (
      <>
        <Input
          className={isFocused ? undefined : "transparent-input"}
          onFocus={() => setFocusedRow(record.index)}
          onBlur={() => setFocusedRow(null)}
          value={record.key}
          onChange={(evt) => updatePropName(record.index, evt.target.value)}
          placeholder="Property"
          size="small"
        />
        {error != null && error[0] === record.index ? (
          <>
            <br />
            <Typography.Text type="warning">{error[1]}</Typography.Text>
          </>
        ) : null}
      </>
    );
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sidebar-label">Metadata</div>
      <div className="ant-tag antd-app-theme metadata-table-wrapper">
        {/* Not using AntD Table to have more control over the styling. */}
        <table className="ant-tag antd-app-theme metadata-table">
          <thead>
            <tr>
              <th>Property</th>
              <th />
              <th>Value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {sortedDetails.map((record) => {
              return (
                <tr key={record.index}>
                  <td>{getKeyInput(record)}</td>
                  <td>:</td>
                  <td>{getValueInput(record)}</td>
                  <td>
                    <DeleteOutlined
                      onClick={() => deleteKey(record.index)}
                      style={{
                        color: "var(--ant-color-text-tertiary)",
                        width: 16,
                      }}
                    />
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={3}>
                <div className="flex-center-child">
                  <Dropdown
                    menu={getTypeSelectDropdownMenu()}
                    placement="bottom"
                    trigger={["hover", "click"]}
                    autoFocus
                  >
                    <Button ghost size="small" style={{ border: "none" }}>
                      <PlusOutlined size={18} style={{ color: "var(--ant-color-text-tertiary)" }} />
                    </Button>
                  </Dropdown>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
