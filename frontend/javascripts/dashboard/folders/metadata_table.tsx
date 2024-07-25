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
import React, { memo } from "react";
import { useState } from "react";
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

const updateMetadataDebounced = _.debounce(
  async (
    context: DatasetCollectionContextValue,
    selectedDatasetOrFolder: APIDataset | Folder,
    metadata: APIMetadataEntries,
    setIfUpdatePending: (value: boolean) => void,
    setDidUpdateSucceed: (value: boolean) => void,
  ) => {
    setIfUpdatePending(false);
    if ("folderId" in selectedDatasetOrFolder) {
      // In case of a dataset, update the dataset's metadata.
      try {
        const updatedDataset = await context.updateCachedDataset(selectedDatasetOrFolder, {
          metadata: metadata,
        });
        setDidUpdateSucceed(_.isEqual(updatedDataset.metadata, metadata));
      } catch (error) {
        console.error(error);
        setDidUpdateSucceed(false);
      }
    } else {
      // Else update the folders metadata.
      const folder = selectedDatasetOrFolder;
      try {
        const updatedFolder = await context.queries.updateFolderMutation.mutateAsync({
          ...folder,
          allowedTeams: folder.allowedTeams?.map((t) => t.id) || [],
          metadata,
        });
        setDidUpdateSucceed(_.isEqual(updatedFolder.metadata, metadata));
      } catch (error) {
        console.error(error);
        setDidUpdateSucceed(false);
      }
    }
  },
  3000,
);

type APIMetadataWithIndexAndError = APIMetadata & { index: number; error?: string | null };
type IndexedMetadataEntries = APIMetadataWithIndexAndError[];

const isDataset = (datasetOrFolder: APIDataset | Folder): datasetOrFolder is APIDataset =>
  "folderId" in datasetOrFolder;

export default function MetadataTable({
  datasetOrFolder,
}: { datasetOrFolder: APIDataset | Folder }) {
  const context = useDatasetCollectionContext();
  const [metadata, setMetadata] = useState<IndexedMetadataEntries>(
    datasetOrFolder?.metadata?.map((entry, index) => ({ ...entry, index, error: null })) || [],
  );
  const [focusedRow, setFocusedRow] = useState<number | null>(null);
  // Save the current dataset or folder name and the type of it to be able to determine whether the passed datasetOrFolder to this component changed.
  const [currentDatasetOrFolderName, setCurrentDatasetOrFolderName] = useState<string>(
    datasetOrFolder.name,
  );
  const [isCurrentEntityADataset, setIsCurrentEntityADataset] = useState<boolean>(
    isDataset(datasetOrFolder),
  );

  const [isAddEntryDropdownOpen, setIsAddEntryDropdownOpen] = useState(false);

  const [isUpdatePending, setIfUpdatePending] = useState(false);
  const [didUpdateSucceed, setDidUpdateSucceed] = useState(true);
  const flushPendingUpdates = async () => {
    if (!isUpdatePending) return;
    setIfUpdatePending(false);
    updateMetadataDebounced.flush();
  };
  function updateMetadataDebouncedTracked(
    context: DatasetCollectionContextValue,
    selectedDatasetOrFolder: APIDataset | Folder,
    metadata: APIMetadataEntries,
  ) {
    setIfUpdatePending(true);
    updateMetadataDebounced(
      context,
      selectedDatasetOrFolder,
      metadata,
      setIfUpdatePending,
      setDidUpdateSucceed,
    );
  }

  // Always update local state when folder / dataset changes or the result of the update request
  // to the backend is resolved shown by a changed value in selectedDatasetOrFolder.metadata.
  useEffectOnUpdate(() => {
    const isSameName = datasetOrFolder.name === currentDatasetOrFolderName;
    const isSameType = isDataset(datasetOrFolder) === isCurrentEntityADataset;
    const isSameDatasetOrFolder = isSameName && isSameType;
    if (isUpdatePending && !isSameDatasetOrFolder) {
      // Flush pending updates as the dataset or folder changed and its metadata should be shown now.
      flushPendingUpdates();
    }
    // Ignore updates in case they weres successful and the dataset or folder is the same as before to avoid undoing changes made by the user during the debounce time.
    const ignoreLocalMetadataUpdate = didUpdateSucceed && isSameDatasetOrFolder;
    if (!ignoreLocalMetadataUpdate) {
      // Update state to newest metadata from selectedDatasetOrFolder.
      setMetadata(datasetOrFolder.metadata?.map((entry, index) => ({ ...entry, index })) || []);
    }
    setCurrentDatasetOrFolderName(datasetOrFolder.name);
    setIsCurrentEntityADataset(isDataset(datasetOrFolder));
  }, [datasetOrFolder.name, datasetOrFolder.metadata]);

  useEffectOnUpdate(() => {
    const hasErrors = metadata.some((entry) => entry.error != null);
    if (hasErrors) {
      return;
    }
    const metadataWithoutIndexAndError = metadata.map(
      ({ index: _ignored, error: _ignored2, ...rest }) => rest,
    );
    const didMetadataChange = !_.isEqual(metadataWithoutIndexAndError, datasetOrFolder.metadata);
    if (didMetadataChange) {
      updateMetadataDebouncedTracked(context, datasetOrFolder, metadataWithoutIndexAndError);
    }
  }, [metadata]);

  // On component unmount flush pending updates to avoid potential data loss.
  useWillUnmount(() => {
    flushPendingUpdates();
  });

  const updateMetadataKey = (index: number, newPropName: string) => {
    setMetadata((prev) => {
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
        onClick: () => {
          setIsAddEntryDropdownOpen(false);
          addNewEntryWithType(type as APIMetadata["type"]);
        },
      };
    }),
  });

  const getKeyInputId = (record: APIMetadataWithIndexAndError) =>
    `metadata-key-input-id-${record.index}`;

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

  const renderMetadataRow = (record: APIMetadataWithIndexAndError) => (
    <tr key={record.index}>
      <td>{getKeyInput(record)}</td>
      <td>:</td>
      <td>{getValueInput(record)}</td>
      <td>{getDeleteEntryButton(record)}</td>
    </tr>
  );

  function AddNewEntryDropdown({ children }: { children: React.ReactNode }) {
    return (
      <Dropdown
        menu={getTypeSelectDropdownMenu()}
        placement="bottom"
        open={isAddEntryDropdownOpen}
        onOpenChange={(open) => setIsAddEntryDropdownOpen(open)}
        trigger={["click"]}
        autoFocus
      >
        {children}
      </Dropdown>
    );
  }

  const AddNewMetadataEntryRow = memo(function AddNewMetadataEntryRow() {
    return (
      <tr>
        <td colSpan={3}>
          <div className="flex-center-child">
            <Dropdown
              menu={getTypeSelectDropdownMenu()}
              placement="bottom"
              open={isAddEntryDropdownOpen}
              onOpenChange={(open) => setIsAddEntryDropdownOpen(open)}
              trigger={["click"]}
              autoFocus
            >
              <Button ghost size="small" style={{ border: "none" }}>
                <PlusOutlined size={18} style={{ color: "var(--ant-color-text-tertiary)" }} />
              </Button>
            </Dropdown>
          </div>
        </td>
      </tr>
    );
  });

  function EmptyTablePlaceholder() {
    return (
      <div className="flex-center-child empty-metadata-placeholder">
        <img
          src="/assets/images/metadata-teaser.svg"
          alt="Metadata preview"
          style={{ width: "60%", marginBottom: 16 }}
        />
        <span style={{ marginTop: 10 }}>
          <AddNewEntryDropdown>
            <Button icon={<PlusOutlined style={{ marginLeft: -2 }} />}>
              Add First Metadata Entry
            </Button>
          </AddNewEntryDropdown>
        </span>
      </div>
    );
  }

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
              {sortedDetails.map(renderMetadataRow)}
              <AddNewMetadataEntryRow />
            </tbody>
          </table>
        ) : (
          <EmptyTablePlaceholder />
        )}
      </div>
    </div>
  );
}
