import { useWkSelector } from "libs/react_hooks";
import { Link } from "react-router";
import { WkDevFlags } from "viewer/api/wk_dev";
import { ControlModeEnum } from "viewer/constants";
import { mayEditAnnotationProperties } from "viewer/model/accessors/annotation_accessor";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import { AnnotationStatisticsSection } from "./annotation_stats_section";
import { DatasetAnnotationCountLink } from "./dataset_annotation_count_link";
import { DatasetExtentRow } from "./dataset_extent_row";
import { DebugInfo } from "./debug_info";
import {
  AnnotationIdentityBlock,
  DatasetIdentityBlock,
  DatasetSettingsButton,
} from "./identity_block";
import { InfoTabRow, InfoTabSection } from "./info_tab_layout";
import { KeyboardShortcutsSection } from "./keyboard_shortcuts_section";
import { MagInfoRow } from "./mag_info_row";
import { DatasetOwningOrganizationRow } from "./owning_organization_row";
import { PeopleSection } from "./people_section";
import { VoxelSizeRow } from "./voxel_size_row";

const datasetInfoTabId = "dataset-info-tab";

export default function DatasetInfoTabView() {
  const isDatasetViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );

  return (
    <div id={datasetInfoTabId} className="flex-overflow info-tab">
      <DomVisibilityObserver targetId={datasetInfoTabId}>
        {(isVisibleInDom) =>
          // Skip rendering entirely while the tab is hidden. The annotation identity block
          // keeps its own modal mounted, so it stays rendered while that modal is open.
          isVisibleInDom ? (
            <>
              {WkDevFlags.debugging.showCurrentVersionInInfoTab && <DebugInfo />}
              {isDatasetViewMode ? <DatasetInfoPanel /> : <AnnotationInfoPanel />}
            </>
          ) : null
        }
      </DomVisibilityObserver>
    </div>
  );
}

function DatasetInfoPanel() {
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);

  return (
    <>
      <DatasetIdentityBlock dataset={dataset} activeUser={activeUser} />
      <InfoTabSection label="Dataset">
        <VoxelSizeRow dataset={dataset} />
        <DatasetExtentRow dataset={dataset} />
        <MagInfoRow />
        <DatasetOwningOrganizationRow />
        <DatasetAnnotationCountLink dataset={dataset} label="Annotations" />
      </InfoTabSection>
      <KeyboardShortcutsSection />
    </>
  );
}

function AnnotationInfoPanel() {
  const dataset = useWkSelector((state) => state.dataset);
  const activeUser = useWkSelector((state) => state.activeUser);
  const task = useWkSelector((state) => state.task);
  const annotationName = useWkSelector((state) => state.annotation.name);
  const annotationDescription = useWkSelector((state) => state.annotation.description);
  const mayEditAnnotation = useWkSelector(mayEditAnnotationProperties);

  return (
    <>
      <AnnotationIdentityBlock
        name={annotationName}
        description={annotationDescription}
        mayEdit={mayEditAnnotation}
      />
      {task != null ? (
        <InfoTabSection label="Task">
          <InfoTabRow label="Task ID">{task.id}</InfoTabRow>
        </InfoTabSection>
      ) : null}
      <InfoTabSection
        label="Dataset"
        action={<DatasetSettingsButton dataset={dataset} activeUser={activeUser} />}
      >
        <InfoTabRow label="Name">
          <Link
            to={getViewDatasetURL(dataset)}
            title={`Click to view dataset ${dataset.name} without annotation`}
            style={{ fontWeight: 600 }}
          >
            {dataset.name}
          </Link>
        </InfoTabRow>
        <VoxelSizeRow dataset={dataset} />
        <DatasetExtentRow dataset={dataset} />
        <MagInfoRow />
        <DatasetOwningOrganizationRow />
        <DatasetAnnotationCountLink dataset={dataset} label="Other annotations" />
      </InfoTabSection>
      <PeopleSection />
      <AnnotationStatisticsSection />
    </>
  );
}
