// Info tab of the unified datasets prototype (features.unifiedDatasets): one identity block for
// the dataset. The backing annotation that holds the annotation layers is never shown as an object.
import { updateDatasetPartial } from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { useDispatch } from "react-redux";
import { Link } from "react-router";
import { isBackingAnnotationLoaded } from "viewer/model/accessors/unified_dataset_accessor";
import { setDatasetAction } from "viewer/model/actions/dataset_actions";
import type { StoreDataset } from "viewer/store";
import { AnnotationStatisticsSection } from "./annotation_stats_section";
import { DatasetExtentRow } from "./dataset_extent_row";
import { AnnotationIdentity, DatasetSettingsButton } from "./identity_block";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";
import { KeyboardShortcutsSection } from "./keyboard_shortcuts_section";
import { MagInfoRow } from "./mag_info_row";
import { DatasetOwningOrganizationRow } from "./owning_organization_row";
import { VoxelSizeRow } from "./voxel_size_row";

function useUpdateDatasetField() {
  const dispatch = useDispatch();
  const dataset = useWkSelector((state) => state.dataset);
  return async (field: "name" | "description", value: string) => {
    try {
      await updateDatasetPartial(dataset.id, { [field]: value });
      const updatedDataset: StoreDataset = { ...dataset, [field]: value };
      dispatch(setDatasetAction(updatedDataset));
    } catch (error) {
      Toast.error(`Could not update the dataset ${field}.`);
      console.error(error);
    }
  };
}

function DatasetIdentity() {
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);
  const updateField = useUpdateDatasetField();
  const mayEdit = dataset.isEditable;

  return (
    <div style={{ position: "relative" }}>
      <AnnotationIdentity
        name={dataset.name}
        description={dataset.description ?? ""}
        onChangeName={mayEdit ? (name) => updateField("name", name) : undefined}
        onChangeDescription={
          mayEdit ? (description) => updateField("description", description) : undefined
        }
        hideEmptyDescription
        objectNoun="dataset"
      />
      <div style={{ position: "absolute", top: 0, right: 0 }}>
        <DatasetSettingsButton dataset={dataset} activeUser={activeUser} />
      </div>
    </div>
  );
}

function OwnerRow() {
  const owner = useWkSelector((state) => state.dataset.owner);
  if (owner == null) return null;
  return <InfoTabRow label="Owner">{owner.fullName}</InfoTabRow>;
}

function CopiedFromRow() {
  const copiedFrom = useWkSelector((state) => state.dataset.copiedFrom);
  if (copiedFrom == null) return null;
  return (
    <InfoTabRow label="Copy of">
      <Link to={`/datasets/${copiedFrom.id}/view`}>{copiedFrom.name}</Link>
    </InfoTabRow>
  );
}

function CopiesRow() {
  const datasetId = useWkSelector((state) => state.dataset.id);
  const copyCount = useWkSelector((state) => state.dataset.copyCount);
  if (!copyCount) return null;
  return (
    <InfoTabRow label="Copies" isShortValue tooltip="Show the copies of this dataset">
      <Link to={`/dashboard/datasets?copiesOf=${datasetId}`}>
        {copyCount} {copyCount === 1 ? "copy" : "copies"} ›
      </Link>
    </InfoTabRow>
  );
}

export function UnifiedDatasetInfoPanel() {
  const dataset = useWkSelector((state) => state.dataset);
  const hasAnnotationLayers = useWkSelector(
    (state) => isBackingAnnotationLoaded(state) && state.annotation.annotationLayers.length > 0,
  );

  return (
    <>
      <DatasetIdentity />
      <InfoTabSection label="Dataset">
        <OwnerRow />
        <CopiedFromRow />
        <VoxelSizeRow dataset={dataset} />
        <DatasetExtentRow dataset={dataset} />
        <MagInfoRow />
        <DatasetOwningOrganizationRow />
        <CopiesRow />
      </InfoTabSection>
      {hasAnnotationLayers ? <AnnotationStatisticsSection /> : null}
      <KeyboardShortcutsSection />
    </>
  );
}
