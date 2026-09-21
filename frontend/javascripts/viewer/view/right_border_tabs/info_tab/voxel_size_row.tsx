import Icon from "@ant-design/icons";
import IconVoxelsize from "@images/icons/icon-voxelsize.svg?react";
import FastTooltip from "components/fast_tooltip";
import { copyToClipboard } from "libs/clipboard";
import { formatScale, formatScaleForClipboard } from "libs/format_utils";
import type { APIDataset } from "types/api_types";

export function VoxelSizeRow({ dataset }: { dataset: APIDataset }) {
  const copyVoxelSizeToClipboard = () => {
    copyToClipboard(formatScaleForClipboard(dataset.dataSource.scale), "dataset voxel size", true);
  };

  return (
    <FastTooltip title="Dataset voxel size" placement="left" wrapper="tr">
      <td
        style={{
          paddingRight: 20,
        }}
      >
        <Icon component={IconVoxelsize} className="info-tab-icon" aria-label="Voxel size" />
      </td>
      <td onClick={copyVoxelSizeToClipboard}>{formatScale(dataset.dataSource.scale)}</td>
    </FastTooltip>
  );
}
