import {
  CloseOutlined,
  FieldNumberOutlined,
  FieldStringOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import {
  type MenuProps,
  type InputNumberProps,
  InputNumber,
  Input,
  Select,
  Dropdown,
  Button,
  Tag,
} from "antd";
import FastTooltip from "components/fast_tooltip";
import {
  type DatasetCollectionContextValue,
  useDatasetCollectionContext,
} from "dashboard/dataset/dataset_collection_context";
import { useIsMounted, useStateWithRef } from "libs/react_hooks";
import Toast from "libs/toast";
import _ from "lodash";
import { InputWithUpdateOnBlur } from "oxalis/view/components/input_with_update_on_blur";
import type React from "react";
import { useEffect } from "react";
import { useState } from "react";
import {
  type APIDataset,
  type Folder,
  type APIMetadataEntry,
  APIMetadataEnum,
} from "types/api_flow_types";

export type APIMetadataWithError = APIMetadataEntry & { error?: string | null };

function getMetadataTypeLabel(type: APIMetadataEntry["type"]) {
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

export function getTypeSelectDropdownMenu(
  addNewEntryWithType: (type: APIMetadataEntry["type"]) => void,
): MenuProps {
  return {
    items: Object.values(APIMetadataEnum).map((type) => {
      return {
        key: type,
        label: getMetadataTypeLabel(type as APIMetadataEntry["type"]),
        onClick: () => addNewEntryWithType(type as APIMetadataEntry["type"]),
      };
    }),
  };
}

type EmptyMetadataPlaceholderProps = {
  addNewEntryMenuItems: MenuProps;
};
const EmptyMetadataPlaceholder: React.FC<EmptyMetadataPlaceholderProps> = ({
  addNewEntryMenuItems,
}) => {
  return (
    <Tag>
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
    </Tag>
  );
};

export function getUsedTagsWithinMetadata(metadata: APIMetadataWithError[]) {
  return _.uniq(
    metadata.flatMap((entry) => (entry.type === APIMetadataEnum.STRING_ARRAY ? entry.value : [])),
  ).map((tag) => ({ value: tag, label: tag })) as {
    value: string;
    label: string;
  }[];
}

interface MetadataValueInputProps {
  entry: APIMetadataWithError;
  index: number;
  focusedRow?: number | null;
  setFocusedRow?: (row: number | null) => void;
  updateMetadataValue: (
    index: number,
    newValue: number | string | string[],
    type: APIMetadataEnum,
  ) => void;
  isSaving?: boolean;
  readOnly?: boolean;
  availableStrArrayTagOptions: { value: string; label: string }[];
}

export const MetadataValueInput: React.FC<MetadataValueInputProps> = ({
  entry,
  index,
  focusedRow,
  setFocusedRow,
  updateMetadataValue,
  isSaving,
  readOnly,
  availableStrArrayTagOptions,
}) => {
  const isFocused = index === focusedRow;
  const sharedProps = {
    className: isFocused ? undefined : "transparent-input",
    onFocus: () => setFocusedRow?.(index),
    onBlur: () => setFocusedRow?.(null),
    size: "small" as InputNumberProps<number>["size"],
    disabled: isSaving || readOnly,
  };

  switch (entry.type) {
    case APIMetadataEnum.NUMBER:
      return (
        <InputNumber
          value={entry.value as number}
          controls={false}
          placeholder="Enter a number"
          onChange={(newNum) => {
            return updateMetadataValue(index, newNum || 0, APIMetadataEnum.NUMBER);
          }}
          {...sharedProps}
        />
      );
    case APIMetadataEnum.STRING:
      return (
        <InputWithUpdateOnBlur
          value={entry.value as string}
          placeholder="Enter text"
          onChange={(newValue) =>
            updateMetadataValue(index, newValue as string, APIMetadataEnum.STRING)
          }
          {...sharedProps}
        />
      );
    case APIMetadataEnum.STRING_ARRAY:
      return (
        <Select
          mode="tags"
          placeholder="Enter multiple entries"
          value={entry.value as string[]}
          onChange={(values) => updateMetadataValue(index, values, APIMetadataEnum.STRING_ARRAY)}
          options={availableStrArrayTagOptions}
          suffixIcon={null}
          variant="filled"
          {...sharedProps}
        />
      );
    default:
      return null;
  }
};

const saveCurrentMetadata = async (
  datasetOrFolderToUpdate: APIDataset | Folder,
  metadata: APIMetadataWithError[],
  context: DatasetCollectionContextValue,
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
      serverResponse = await context.updateCachedDataset(datasetOrFolderToUpdate.id, {
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

const saveMetadataDebounced = _.debounce(
  (
    datasetOrFolder,
    metadata,
    context,
    guardedSetIsSaving,
    guardedSetHasUnsavedChanges,
    hasUnsavedChangesRef,
    focusedRowRef,
  ) => {
    // Before updating the metadata check again if there is no focused row.
    if (hasUnsavedChangesRef.current && focusedRowRef.current === null) {
      saveCurrentMetadata(
        datasetOrFolder,
        metadata,
        context,
        guardedSetIsSaving,
        guardedSetHasUnsavedChanges,
      );
    }
  },
  2000,
);

const getKeyInputIdForIndex = (index: number) => `metadata-key-input-id-${index}`;

const isDataset = (datasetOrFolder: APIDataset | Folder): datasetOrFolder is APIDataset =>
  "folderId" in datasetOrFolder;

// !Important! It is necessary to remount the component when the dataset or folder changes
// to ensure the metadata is displayed and saved correctly.
export default function MetadataTable({
  datasetOrFolder,
}: { datasetOrFolder: APIDataset | Folder }) {
  const context = useDatasetCollectionContext();
  const [metadata, metadataRef, setMetadata] = useStateWithRef<APIMetadataWithError[]>(
    datasetOrFolder?.metadata?.map((entry) => ({ ...entry, error: null })) || [],
  );
  const [focusedRow, focusedRowRef, setFocusedRow] = useStateWithRef<number | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [hasUnsavedChanges, hasUnsavedChangesRef, setHasUnsavedChanges] =
    useStateWithRef<boolean>(false);
  const isMounted = useIsMounted();

  // Flush pending updates when the component is unmounted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only update when unmounted.
  useEffect(
    () => () => {
      if (hasUnsavedChangesRef.current && metadataRef.current != null) {
        // Clear all pending updates before sending final update before unmount.
        saveMetadataDebounced.cancel();
        saveCurrentMetadata(
          datasetOrFolder,
          metadataRef.current,
          context,
          _.noop, // No state updates on unmounted component.
          _.noop, // No state updates on unmounted component.
        );
      }
    },
    [metadataRef, hasUnsavedChangesRef],
  );

  // Send automatic async debounced updates to the server when metadata changed and there are no focused rows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Only update upon pending changes.
  useEffect(() => {
    // Avoid state updates on unmounted MetadataTable.
    const guardedSetIsSaving = (isSaving: boolean) => {
      if (isMounted()) {
        setIsSaving(isSaving);
      }
    };
    const guardedSetHasUnsavedChanges = (hasUnsavedChanges: boolean) => {
      if (isMounted()) {
        setHasUnsavedChanges(hasUnsavedChanges);
      }
    };
    if (hasUnsavedChanges && focusedRow === null) {
      saveMetadataDebounced(
        datasetOrFolder,
        metadata,
        context,
        guardedSetIsSaving,
        guardedSetHasUnsavedChanges,
        hasUnsavedChangesRef,
        focusedRowRef,
      );
    }
  }, [metadata, hasUnsavedChanges, focusedRow]);

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

  const updateMetadataValue = (
    indexToUpdate: number,
    newValue: number | string | string[],
    _type: APIMetadataEnum,
  ) => {
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

  const addNewEntryWithType = (type: APIMetadataEntry["type"]) => {
    setMetadata((prev) => {
      const indexOfNewEntry = prev.length;
      const newEntry: APIMetadataWithError = {
        key: "",
        value:
          type === APIMetadataEnum.STRING_ARRAY ? [] : type === APIMetadataEnum.NUMBER ? 0 : "",
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

  const availableStrArrayTagOptions = getUsedTagsWithinMetadata(metadata);

  const getKeyInput = (entry: APIMetadataWithError, index: number) => {
    const isFocused = index === focusedRow;
    return (
      <>
        <FastTooltip title={entry.error} placement="left" variant="warning">
          <Input
            className={isFocused ? undefined : "transparent-input"}
            onFocus={() => setFocusedRow(index)}
            onBlur={() => setFocusedRow(null)}
            value={entry.key}
            onChange={(evt) => updateMetadataKey(index, evt.target.value)}
            placeholder="Property"
            size="small"
            disabled={isSaving}
            id={getKeyInputIdForIndex(index)}
            status={entry.error != null ? "warning" : undefined}
            // Use a span as an empty prefix, because null would lose the focus
            // when the prefix changes.
            prefix={entry.error != null ? <InfoCircleOutlined /> : <span />}
          />
        </FastTooltip>
      </>
    );
  };

  const getValueInput = (entry: APIMetadataWithError, index: number) => {
    return (
      <MetadataValueInput
        entry={entry}
        index={index}
        focusedRow={focusedRow}
        setFocusedRow={setFocusedRow}
        updateMetadataValue={updateMetadataValue}
        isSaving={isSaving}
        availableStrArrayTagOptions={availableStrArrayTagOptions}
      />
    );
  };

  const getDeleteEntryButton = (_: APIMetadataWithError, index: number) => (
    <div className="flex-center-child">
      <Button
        type="text"
        disabled={isSaving}
        icon={
          <CloseOutlined
            style={{
              color: "var(--ant-color-text-tertiary)",
              width: 16,
            }}
          />
        }
        style={{ width: 16, height: 19 }}
        onClick={() => deleteKey(index)}
      />
    </div>
  );

  const addNewEntryMenuItems = getTypeSelectDropdownMenu(addNewEntryWithType);

  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sidebar-label">Metadata</div>
      <div className="ant-tag antd-app-theme dashboard-metadata-table-wrapper">
        {/* Not using AntD Table to have more control over the styling. */}
        {metadata.length > 0 ? (
          <InnerMetadataTable
            metadata={metadata}
            getKeyInput={getKeyInput}
            getValueInput={getValueInput}
            getDeleteEntryButton={getDeleteEntryButton}
            addNewEntryMenuItems={addNewEntryMenuItems}
          />
        ) : (
          <EmptyMetadataPlaceholder addNewEntryMenuItems={addNewEntryMenuItems} />
        )}
      </div>
    </div>
  );
}

export function InnerMetadataTable({
  metadata,
  getKeyInput,
  getValueInput,
  getDeleteEntryButton,
  addNewEntryMenuItems,
  onlyReturnRows,
  readOnly,
}: {
  metadata: APIMetadataWithError[];
  getKeyInput: (entry: APIMetadataWithError, index: number) => JSX.Element;
  getValueInput: (entry: APIMetadataWithError, index: number) => JSX.Element;
  getDeleteEntryButton: (_: APIMetadataWithError, index: number) => JSX.Element;
  addNewEntryMenuItems: MenuProps;
  onlyReturnRows?: boolean;
  readOnly?: boolean;
}): React.ReactElement {
  const rows = (
    <>
      {metadata.map((entry, index) => (
        <tr key={index}>
          <td>{getKeyInput(entry, index)}</td>
          <td>{getValueInput(entry, index)}</td>
          <td>{getDeleteEntryButton(entry, index)}</td>
        </tr>
      ))}
      {readOnly ? null : (
        <tr>
          <td colSpan={3}>
            <div className="flex-center-child">
              <FastTooltip title="Add a new metadata property">
                <Dropdown
                  menu={addNewEntryMenuItems}
                  placement="bottom"
                  trigger={["click"]}
                  autoFocus
                >
                  <Button
                    className="add-property-button"
                    ghost
                    size="small"
                    style={{ border: "none" }}
                  >
                    <PlusOutlined size={18} style={{ color: "var(--ant-color-text-tertiary)" }} />
                  </Button>
                </Dropdown>
              </FastTooltip>
            </div>
          </td>
        </tr>
      )}
    </>
  );

  if (onlyReturnRows) {
    return rows;
  }

  return (
    <table className="metadata-table">
      <thead>
        <tr>
          <th>Property</th>
          <th colSpan={2}>Value</th>
        </tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
  );
}
