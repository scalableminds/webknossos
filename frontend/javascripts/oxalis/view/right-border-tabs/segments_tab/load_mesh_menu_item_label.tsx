import { WarningOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import type { VolumeTracing } from "oxalis/store";
import type { APIMeshFileInfo } from "types/api_flow_types";

type Props = {
  currentMeshFile: APIMeshFileInfo | null | undefined;
  volumeTracing: VolumeTracing | null | undefined;
};

export function LoadMeshMenuItemLabel({ currentMeshFile, volumeTracing }: Props) {
  const showWarning =
    volumeTracing?.volumeBucketDataHasChanged ??
    // For older annotations, volumeBucketDataHasChanged can be undefined.
    // In that case, we still want to show a warning if no proofreading was
    // done, but the mapping is still locked (i.e., the user brushed).
    (!volumeTracing?.hasEditableMapping && volumeTracing?.mappingIsLocked);

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
      <FastTooltip
        title={
          currentMeshFile != null
            ? `Load mesh for centered segment from file ${currentMeshFile.name}`
            : "There is no mesh file."
        }
      >
        <span>Load Mesh (precomputed)</span>
      </FastTooltip>
      {showWarning && (
        <FastTooltip title="Warning: The segmentation data has changed since the mesh file was created. The mesh may not match the current data.">
          <WarningOutlined style={{ color: "var(--ant-color-warning)" }} />
        </FastTooltip>
      )}
    </span>
  );
}
