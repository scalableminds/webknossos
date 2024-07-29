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
import { usePreviousValue } from "beautiful-react-hooks";
import {
  DatasetCollectionContextValue,
  useDatasetCollectionContext,
} from "dashboard/dataset/dataset_collection_context";
import Toast from "libs/toast";
import _ from "lodash";
import React, { useEffect } from "react";
import { useState } from "react";
import { APIDataset, Folder, APIMetadata, APIMetadataType } from "types/api_flow_types";

function getMetadataTypeLabel(type: APIMetadata["type"]) {
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

const saveCurrentMetadata = async (
  datasetOrFolderToUpdate: APIDataset | Folder,
  metadata: IndexedMetadataEntries,
  context: DatasetCollectionContextValue,
  { dontUpdateState }: EffectCancelSignal = { dontUpdateState: false }, // equals whether the component is unmounted
  setIsSaving: (isSaving: boolean) => void,
  setHasUnsavedChanges: (hasUnsavedChanges: boolean) => void,
) => {
  const hasAnyErrors = metadata.some((entry) => entry.error != null);
  if (hasAnyErrors) {
    return;
  }
  !dontUpdateState && setIsSaving(true);
  const metadataWithoutIndexAndError = metadata.map(
    ({ index: _ignored, error: _ignored2, ...rest }) => rest,
  );
  let serverResponse: APIDataset | Folder;
  const isADataset = isDataset(datasetOrFolderToUpdate);
  const datasetOrFolderString = isADataset ? "dataset" : "folder";
  try {
    if (isADataset) {
      // In case of a dataset, update the dataset's metadata.
      serverResponse = await context.updateCachedDataset(datasetOrFolderToUpdate, {
        metadata: metadataWithoutIndexAndError,
      });
    } else {
      // Else update the folders metadata.
      const folder: Folder = datasetOrFolderToUpdate;
      serverResponse = await context.queries.updateFolderMutation.mutateAsync({
        ...folder,
        allowedTeams: folder.allowedTeams?.map((t) => t.id) || [],
        metadata: metadataWithoutIndexAndError,
      });
    }
    if (!_.isEqual(serverResponse.metadata, metadataWithoutIndexAndError)) {
      Toast.error(
        `Failed to save metadata changes for ${datasetOrFolderString} ${datasetOrFolderToUpdate.name}.`,
      );
    } else {
      !dontUpdateState && setHasUnsavedChanges(false);
    }
  } catch (error) {
    Toast.error(
      `Failed to save metadata changes for ${datasetOrFolderString} ${datasetOrFolderToUpdate.name}. Please look in the console for more details.`,
    );
    console.error(error);
  } finally {
    !dontUpdateState && setIsSaving(false);
  }
};

const saveCurrentMetadataDebounced = _.debounce(saveCurrentMetadata, 3000);

const getKeyInputId = (record: APIMetadataWithIndexAndError) =>
  `metadata-key-input-id-${record.index}`;

type APIMetadataWithIndexAndError = APIMetadata & { index: number; error?: string | null };
type IndexedMetadataEntries = APIMetadataWithIndexAndError[];
type EffectCancelSignal = { dontUpdateState: boolean };

const isDataset = (datasetOrFolder: APIDataset | Folder): datasetOrFolder is APIDataset =>
  "folderId" in datasetOrFolder;

export default function MetadataTable({
  datasetOrFolder,
}: { datasetOrFolder: APIDataset | Folder }) {
  const context = useDatasetCollectionContext();
  const previousDatasetOrFolder: APIDataset | Folder | undefined =
    usePreviousValue(datasetOrFolder);
  const [metadata, setMetadata] = useState<IndexedMetadataEntries>(
    datasetOrFolder?.metadata?.map((entry, index) => ({ ...entry, index, error: null })) || [],
  );
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  const isFirstRenderingCycle = previousDatasetOrFolder == null;

  // Always update local state when folder / dataset changes. Prior to that send pending updates.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only execute this hook when underlying datasetOrFolder changes.
  useEffect(() => {
    if (isFirstRenderingCycle) {
      // Skip first rendering cycle.
      return;
    }
    const isSameName = datasetOrFolder.name === previousDatasetOrFolder.name;
    const isSameType = isDataset(datasetOrFolder) === isDataset(previousDatasetOrFolder);
    const isSameDatasetOrFolder = isSameName && isSameType;
    const effectCancelSignal = { dontUpdateState: false };
    if (!isSameDatasetOrFolder && hasUnsavedChanges) {
      // Flush pending updates as the dataset or folder changed.
      saveCurrentMetadata(
        previousDatasetOrFolder,
        metadata,
        context,
        effectCancelSignal,
        setIsSaving,
        setHasUnsavedChanges,
      );
    }
    setMetadata(
      datasetOrFolder.metadata?.map((entry, index) => ({ ...entry, index, error: null })) || [],
    );
    return () => {
      effectCancelSignal.dontUpdateState = true;
    };
  }, [datasetOrFolder.name, isDataset(datasetOrFolder), datasetOrFolder.metadata]);

  // Sent automatic debounced updates to the server when metadata changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only update upon pending changes.
  useEffect(() => {
    const effectCancelSignal = { dontUpdateState: false };
    if (hasUnsavedChanges) {
      saveCurrentMetadataDebounced(
        datasetOrFolder,
        metadata,
        context,
        effectCancelSignal,
        setIsSaving,
        setHasUnsavedChanges,
      );
    }
    return () => {
      effectCancelSignal.dontUpdateState = true;
    };
  }, [metadata]);

  const updateMetadataKey = (index: number, newPropName: string) => {
    setMetadata((prev: IndexedMetadataEntries) => {
      let error = null;
      const entry = prev.find((prop) => prop.index === index);
      if (!entry) {
        return prev;
      }
      const maybeAlreadyExistingEntry = prev.find((prop) => prop.key === newPropName);
      if (maybeAlreadyExistingEntry) {
        error = `Property ${newPropName} already exists.`;
      }
      if (newPropName === "") {
        error = "Property name cannot be empty.";
      }
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      setHasUnsavedChanges(true);
      return [
        ...detailsWithoutEditedEntry,
        {
          ...entry,
          key: newPropName,
          error,
        },
      ];
    });
  };

  const updateMetadataValue = (index: number, newValue: number | string | string[]) => {
    setMetadata((prev) => {
      const entry = prev.find((prop) => prop.index === index);
      if (!entry) {
        return prev;
      }
      const updatedEntry = { ...entry, value: newValue };
      const detailsWithoutEditedEntry = prev.filter((prop) => prop.index !== index);
      setHasUnsavedChanges(true);
      return [...detailsWithoutEditedEntry, updatedEntry];
    });
  };

  const addNewEntryWithType = (type: APIMetadata["type"]) => {
    setMetadata((prev) => {
      const highestIndex = prev.reduce((acc, curr) => Math.max(acc, curr.index), 0);
      const newEntry: APIMetadataWithIndexAndError = {
        key: "",
        value:
          type === APIMetadataType.STRING_ARRAY ? [] : type === APIMetadataType.NUMBER ? 0 : "",
        index: highestIndex + 1,
        type,
        error: "Enter a property name.",
      };
      // Auto focus the key input of the new entry.
      setTimeout(() => document.getElementById(getKeyInputId(newEntry))?.focus(), 50);
      setHasUnsavedChanges(true);
      return [...prev, newEntry];
    });
  };

  const deleteKey = (index: number) => {
    setMetadata((prev) => {
      setHasUnsavedChanges(true);
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
        label: getMetadataTypeLabel(type as APIMetadata["type"]),
        onClick: () => addNewEntryWithType(type as APIMetadata["type"]),
      };
    }),
  });

  const getKeyInput = (record: APIMetadataWithIndexAndError) => {
    const isFocused = record.index === focusedRow;
    return (
      <>
        <Input
          className={isFocused ? undefined : "transparent-input"}
          onFocus={() => setFocusedRow(record.index)}
          onBlur={() => setFocusedRow(null)}
          value={record.key}
          onChange={(evt) => updateMetadataKey(record.index, evt.target.value)}
          placeholder="Property"
          size="small"
          disabled={isSaving}
          id={getKeyInputId(record)}
        />
        {record.error != null ? (
          <>
            <br />
            <Typography.Text type="warning">{record.error}</Typography.Text>
          </>
        ) : null}
      </>
    );
  };

  const getValueInput = (record: APIMetadataWithIndexAndError) => {
    const isFocused = record.index === focusedRow;
    const sharedProps = {
      className: isFocused ? undefined : "transparent-input",
      onFocus: () => setFocusedRow(record.index),
      onBlur: () => setFocusedRow(null),
      placeholder: "Value",
      size: "small" as InputNumberProps<number>["size"],
      disabled: isSaving,
    };
    switch (record.type) {
      case "number":
        return (
          <InputNumber
            value={record.value as number}
            onChange={(newNum) => updateMetadataValue(record.index, newNum || 0)}
            {...sharedProps}
          />
        );
      case "string":
        return (
          <Input
            value={record.value}
            onChange={(evt) => updateMetadataValue(record.index, evt.target.value)}
            {...sharedProps}
          />
        );
      case "string[]":
        return (
          <Select
            mode="tags"
            value={record.value as string[]}
            onChange={(values) => updateMetadataValue(record.index, values)}
            options={availableStrArrayTagOptions}
            suffixIcon={null}
            {...sharedProps}
          />
        );
      default:
        return null;
    }
  };

  const getDeleteEntryButton = (record: APIMetadataWithIndexAndError) => (
    <Button
      type="text"
      disabled={isSaving}
      icon={
        <DeleteOutlined
          style={{
            color: "var(--ant-color-text-tertiary)",
            width: 16,
          }}
        />
      }
      style={{ width: 16 }}
      onClick={() => deleteKey(record.index)}
    />
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sidebar-label">Metadata</div>
      <div className="ant-tag antd-app-theme metadata-table-wrapper">
        {/* Not using AntD Table to have more control over the styling. */}
        {sortedDetails.length > 0 ? (
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
              {sortedDetails.map((record) => (
                <tr key={record.index}>
                  <td>{getKeyInput(record)}</td>
                  <td>:</td>
                  <td>{getValueInput(record)}</td>
                  <td>{getDeleteEntryButton(record)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <div className="flex-center-child">
                    <Dropdown
                      menu={getTypeSelectDropdownMenu()}
                      placement="bottom"
                      trigger={["click"]}
                      autoFocus
                    >
                      <Button ghost size="small" style={{ border: "none" }}>
                        <PlusOutlined
                          size={18}
                          style={{ color: "var(--ant-color-text-tertiary)" }}
                        />
                      </Button>
                    </Dropdown>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <div className="flex-center-child empty-metadata-placeholder">
            <img
              src="/assets/images/metadata-teaser.svg"
              alt="Metadata preview"
              style={{ width: "60%", marginBottom: 16 }}
            />
            <span style={{ marginTop: 10 }}>
              <Dropdown
                menu={getTypeSelectDropdownMenu()}
                placement="bottom"
                trigger={["click"]}
                autoFocus
              >
                <Button icon={<PlusOutlined style={{ marginLeft: -2 }} />}>
                  Add First Metadata Entry
                </Button>
              </Dropdown>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
