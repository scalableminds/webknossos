import { WarningOutlined } from "@ant-design/icons";
import React from "react";
import FastTooltip from "components/fast_tooltip";
import type { VolumeTracing } from "oxalis/store";
import type { APIMeshFile } from "types/api_flow_types";

type Props = {
  currentMeshFile: APIMeshFile | null | undefined;
  volumeTracing: VolumeTracing | null | undefined;
};

export function LoadMeshMenuItemLabel({ currentMeshFile, volumeTracing }: Props) {
  const showWarning =
    volumeTracing?.volumeBucketDataHasChanged ??
    (!volumeTracing?.hasEditableMapping && volumeTracing?.mappingIsLocked);

  return (
    <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
      <FastTooltip
        title={
          currentMeshFile != null
            ? `Load mesh for centered segment from file ${currentMeshFile.meshFileName}`
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
