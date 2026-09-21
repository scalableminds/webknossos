import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import { WkDevFlags } from "viewer/api/wk_dev";
import { ControlModeEnum } from "viewer/constants";
import DomVisibilityObserver from "viewer/view/components/dom_visibility_observer";
import { AnnotationDescriptionBlock } from "./annotation_description_block";
import { AnnotationNameBlock } from "./annotation_name_block";
import { AnnotationStatisticsSection } from "./annotation_stats_block";
import { DatasetExtentRow } from "./dataset_extent_row";
import { DatasetNameBlock } from "./dataset_name_block";
import { DebugInfo } from "./debug_info";
import { KeyboardShortcutsBlock } from "./keyboard_shortcuts_block";
import { MagInfoRow } from "./mag_info_row";
import { OwnerAndContributorsBlocks } from "./owner_and_contributors_blocks";
import { OrganizationBlock } from "./owning_organization_block";
import { VoxelSizeRow } from "./voxel_size_row";

const datasetInfoTabId = "dataset-info-tab";

export default function DatasetInfoTabView() {
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = useState(false);
  const dataset = useWkSelector((state) => state.dataset);
  const isDatasetViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );

  return (
    <div id={datasetInfoTabId} className="flex-overflow padded-tab-content">
      <DomVisibilityObserver targetId={datasetInfoTabId}>
        {(isVisibleInDom) => {
          // Skip rendering entirely while the tab is hidden, except when the
          // markdown modal is open (it would disappear otherwise).
          if (!isVisibleInDom && !isMarkdownModalOpen) {
            return null;
          }

          return (
            <>
              {WkDevFlags.debugging.showCurrentVersionInInfoTab && <DebugInfo />}
              {!isDatasetViewMode && (
                <>
                  <AnnotationNameBlock />
                  <AnnotationDescriptionBlock
                    isMarkdownModalOpen={isMarkdownModalOpen}
                    setIsMarkdownModalOpen={setIsMarkdownModalOpen}
                  />
                </>
              )}
              <DatasetNameBlock isDatasetViewMode={isDatasetViewMode} />
              <OrganizationBlock />
              <OwnerAndContributorsBlocks />

              <div className="info-tab-block">
                <p className="sidebar-label">Dimensions</p>
                <table
                  style={{
                    fontSize: 14,
                    marginLeft: 4,
                  }}
                >
                  <tbody>
                    <VoxelSizeRow dataset={dataset} />
                    <DatasetExtentRow dataset={dataset} />
                    <MagInfoRow />
                  </tbody>
                </table>
              </div>

              {!isDatasetViewMode && <AnnotationStatisticsSection />}
              {isDatasetViewMode && <KeyboardShortcutsBlock />}
            </>
          );
        }}
      </DomVisibilityObserver>
    </div>
  );
}
