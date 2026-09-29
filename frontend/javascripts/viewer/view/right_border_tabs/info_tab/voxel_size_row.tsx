import { copyToClipboard } from "libs/clipboard";
import { formatScaleForClipboard, formatScaleValues } from "libs/format_utils";
import type { APIDataset } from "types/api_types";
import { InfoTabRow, InfoTabUnit } from "./info_tab_layout";

export function VoxelSizeRow({ dataset }: { dataset: APIDataset }) {
  const [voxelSize, unit] = formatScaleValues(dataset.dataSource.scale);

  const copyVoxelSizeToClipboard = () => {
    copyToClipboard(formatScaleForClipboard(dataset.dataSource.scale), "dataset voxel size", true);
  };

  return (
    <InfoTabRow
      label="Voxel size"
      tooltip="Click to copy the dataset voxel size"
      onClick={copyVoxelSizeToClipboard}
    >
      <span>
        {voxelSize}
        <InfoTabUnit>{unit}</InfoTabUnit>
      </span>
    </InfoTabRow>
  );
}
