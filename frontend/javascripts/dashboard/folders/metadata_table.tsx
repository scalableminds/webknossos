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
import Toast from "libs/toast";
import _, { set } from "lodash";
import React, { useEffect } from "react";
import { useState } from "react";
import { APIDataset, Folder, APIMetadata, APIMetadataType } from "types/api_flow_types";

type APIMetadataWithError = APIMetadata & { error?: string | null };
type IndexedMetadataEntries = APIMetadataWithError[];

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

type EmptyMetadataPlaceholderProps = {
  addNewEntryMenuItems: MenuProps;
};
const EmptyMetadataPlaceholder: React.FC<EmptyMetadataPlaceholderProps> = ({
  addNewEntryMenuItems,
}) => {
  return (
    <div className="flex-center-child empty-metadata-placeholder">
      <img
        src="/assets/images/metadata-teaser.svg"
        alt="Metadata preview"
        style={{ width: "60%", marginBottom: 16 }}
      />
      <span style={{ marginTop: 10 }}>
        <Dropdown menu={addNewEntryMenuItems} placement="bottom" trigger={["click"]} autoFocus>
          <Button icon={<PlusOutlined style={{ marginLeft: -2 }} />}>
            Add First Metadata Entry
          </Button>
        </Dropdown>
      </span>
    </div>
  );
};

interface MetadataValueInputProps {
  record: APIMetadataWithError;
  index: number;
  focusedRow: number | null;
  setFocusedRow: (row: number | null) => void;
  updateMetadataValue: (index: number, newValue: number | string | string[]) => void;
  isSaving: boolean;
  availableStrArrayTagOptions: { value: string; label: string }[];
}

const MetadataValueInput: React.FC<MetadataValueInputProps> = ({
  record,
  index,
  focusedRow,
  setFocusedRow,
  updateMetadataValue,
  isSaving,
  availableStrArrayTagOptions,
}) => {
  const isFocused = index === focusedRow;
  const sharedProps = {
    className: isFocused ? undefined : "transparent-input",
    onFocus: () => setFocusedRow(index),
    onBlur: () => setFocusedRow(null),
    placeholder: "Value",
    size: "small" as InputNumberProps<number>["size"],
    disabled: isSaving,
  };

  switch (record.type) {
    case APIMetadataType.NUMBER:
      return (
        <InputNumber
          value={record.value as number}
          onChange={(newNum) => updateMetadataValue(index, newNum || 0)}
          {...sharedProps}
        />
      );
    case APIMetadataType.STRING:
      return (
        <Input
          value={record.value}
          onChange={(evt) => updateMetadataValue(index, evt.target.value)}
          {...sharedProps}
        />
      );
    case APIMetadataType.STRING_ARRAY:
      return (
        <Select
          mode="tags"
          value={record.value as string[]}
          onChange={(values) => updateMetadataValue(index, values)}
          options={availableStrArrayTagOptions}
          suffixIcon={null}
          {...sharedProps}
        />
      );
    default:
      return null;
  }
};

const saveCurrentMetadata = async (
  datasetOrFolderToUpdate: APIDataset | Folder,
  metadata: IndexedMetadataEntries,
  context: DatasetCollectionContextValue,
  // When the component is no longer mounted, state updates should not be performed.
  setIsSaving: (isSaving: boolean) => void,
  setHasUnsavedChanges: (hasUnsavedChanges: boolean) => void,
) => {
  const hasAnyErrors = metadata.some((entry) => entry.error != null);
  if (hasAnyErrors) {
    return;
  }
  setIsSaving(true);
  const metadataWithoutIndexAndError = metadata.map(({ error: _ignored, ...rest }) => rest);
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
      setHasUnsavedChanges(false);
    }
  } catch (error) {
    Toast.error(
      `Failed to save metadata changes for ${datasetOrFolderString} ${datasetOrFolderToUpdate.name}. Please look in the console for more details.`,
    );
    console.error(error);
  } finally {
    setIsSaving(false);
  }
};

const saveCurrentMetadataDebounced = _.debounce(saveCurrentMetadata, 3000);

const getKeyInputIdForIndex = (index: number) => `metadata-key-input-id-${index}`;

const isDataset = (datasetOrFolder: APIDataset | Folder): datasetOrFolder is APIDataset =>
  "folderId" in datasetOrFolder;

export default function MetadataTable({
  datasetOrFolder,
}: { datasetOrFolder: APIDataset | Folder }) {
  const context = useDatasetCollectionContext();
  const [metadata, setMetadata] = useState<IndexedMetadataEntries>(
    datasetOrFolder?.metadata?.map((entry) => ({ ...entry, error: null })) || [],
  );
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isMounted, setIsMounted] = useState<boolean>(true);

  const guardedSetIsSaving = (isSaving: boolean) => {
    if (isMounted) {
      setIsSaving(isSaving);
    }
  };
  const guardedSetHasUnsavedChanges = (hasUnsavedChanges: boolean) => {
    if (isMounted) {
      setHasUnsavedChanges(hasUnsavedChanges);
    }
  };

  useWillUnmount(() => {
    setIsMounted(false);
    if (hasUnsavedChanges) {
      saveCurrentMetadata(
        datasetOrFolder,
        metadata,
        context,
        guardedSetIsSaving,
        guardedSetHasUnsavedChanges,
      );
    }
  });

  // Sent automatic debounced updates to the server when metadata changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only update upon pending changes.
  useEffect(() => {
    if (hasUnsavedChanges) {
      saveCurrentMetadataDebounced(
        datasetOrFolder,
        metadata,
        context,
        guardedSetIsSaving,
        guardedSetHasUnsavedChanges,
      );
    }
  }, [metadata]);

  const updateMetadataKey = (indexToUpdate: number, newPropName: string) => {
    setMetadata((prev) => {
      let error = null;
      const entry = prev[indexToUpdate];
      if (!entry) {
        return prev;
      }
      const maybeAlreadyExistingEntry = prev.find((prop) => prop.key === newPropName);
      if (maybeAlreadyExistingEntry) {
        error = `Property ${newPropName} already exists.`;
      } else if (newPropName === "") {
        error = "Property name cannot be empty.";
      }
      const updatedMetadata = prev.map((prop, index) =>
        index !== indexToUpdate ? prop : { ...prop, error, key: newPropName },
      );
      setHasUnsavedChanges(true);
      return updatedMetadata;
    });
  };

  const updateMetadataValue = (indexToUpdate: number, newValue: number | string | string[]) => {
    setMetadata((prev) => {
      const entry = prev[indexToUpdate];
      if (!entry) {
        return prev;
      }
      const updatedMetadata = prev.map((prop, index) =>
        index !== indexToUpdate ? prop : { ...prop, value: newValue },
      );
      setHasUnsavedChanges(true);
      return updatedMetadata;
    });
  };

  const addNewEntryWithType = (type: APIMetadata["type"]) => {
    setMetadata((prev) => {
      const indexOfNewEntry = prev.length;
      const newEntry: APIMetadataWithError = {
        key: "",
        value:
          type === APIMetadataType.STRING_ARRAY ? [] : type === APIMetadataType.NUMBER ? 0 : "",
        type,
        error: "Enter a property name.",
      };
      // Auto focus the key input of the new entry.
      setTimeout(
        () => document.getElementById(getKeyInputIdForIndex(indexOfNewEntry))?.focus(),
        50,
      );
      setHasUnsavedChanges(true);
      return [...prev, newEntry];
    });
  };

  const deleteKey = (indexToDelete: number) => {
    setMetadata((prev) => {
      setHasUnsavedChanges(true);
      return prev.filter((_, index) => index !== indexToDelete);
    });
  };

  const availableStrArrayTagOptions = _.uniq(
    metadata.flatMap((entry) => (entry.type === APIMetadataType.STRING_ARRAY ? entry.value : [])),
  ).map((tag) => ({ value: tag, label: tag })) as {
    value: string;
    label: string;
  }[];

  const getTypeSelectDropdownMenu: () => MenuProps = () => ({
    items: Object.values(APIMetadataType).map((type) => {
      return {
        key: type,
        label: getMetadataTypeLabel(type as APIMetadata["type"]),
        onClick: () => addNewEntryWithType(type as APIMetadata["type"]),
      };
    }),
  });

  const getKeyInput = (record: APIMetadataWithError, index: number) => {
    const isFocused = index === focusedRow;
    return (
      <>
        <Input
          className={isFocused ? undefined : "transparent-input"}
          onFocus={() => setFocusedRow(index)}
          onBlur={() => setFocusedRow(null)}
          value={record.key}
          onChange={(evt) => updateMetadataKey(index, evt.target.value)}
          placeholder="Property"
          size="small"
          disabled={isSaving}
          id={getKeyInputIdForIndex(index)}
        />
        {record.error != null ? (
          <>
            <br />
            <Typography.Text type="warning" style={{ paddingLeft: 8, display: "inline-block" }}>
              {record.error}
            </Typography.Text>
          </>
        ) : null}
      </>
    );
  };

  const getDeleteEntryButton = (_: APIMetadataWithError, index: number) => (
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
      onClick={() => deleteKey(index)}
    />
  );

  const addNewEntryMenuItems = getTypeSelectDropdownMenu();

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sidebar-label">Metadata</div>
      <div className="ant-tag antd-app-theme metadata-table-wrapper">
        {/* Not using AntD Table to have more control over the styling. */}
        {metadata.length > 0 ? (
          <table className="ant-tag antd-app-theme metadata-table">
            {/* Each row except the last row has a custom horizontal divider created via a css pseudo element. */}
            <thead>
              <tr>
                <th>Property</th>
                <th />
                <th>Value</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {metadata.map((record, index) => (
                <tr key={index}>
                  <td>{getKeyInput(record, index)}</td>
                  <td>:</td>
                  <td>
                    <MetadataValueInput
                      record={record}
                      index={index}
                      focusedRow={focusedRow}
                      setFocusedRow={setFocusedRow}
                      updateMetadataValue={updateMetadataValue}
                      isSaving={isSaving}
                      availableStrArrayTagOptions={availableStrArrayTagOptions}
                    />
                  </td>
                  <td>{getDeleteEntryButton(record, index)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3}>
                  <div className="flex-center-child">
                    <Dropdown
                      menu={addNewEntryMenuItems}
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
          <EmptyMetadataPlaceholder addNewEntryMenuItems={addNewEntryMenuItems} />
        )}
      </div>
    </div>
  );
}
