import Icon from "@ant-design/icons";
import IconExtent from "@images/icons/icon-extent.svg?react";
import FastTooltip from "components/fast_tooltip";
import { copyToClipboard } from "libs/clipboard";
import { formatNumberToVolume, formatVoxels } from "libs/format_utils";
import type { APIDataset } from "types/api_types";
import { LongUnitToShortUnitMap } from "viewer/constants";
import {
  getDatasetExtentAsString,
  getDatasetExtentInUnitAsProduct,
  getDatasetExtentInVoxel,
  getDatasetExtentInVoxelAsProduct,
} from "viewer/model/accessors/dataset_accessor";

export function DatasetExtentRow({ dataset }: { dataset: APIDataset }) {
  const extentInVoxel = getDatasetExtentAsString(dataset, true);
  const extentInLength = getDatasetExtentAsString(dataset, false);
  const extentProductInVx = getDatasetExtentInVoxelAsProduct(dataset);
  const extentProductInUnit = getDatasetExtentInUnitAsProduct(dataset);
  const formattedExtentInUnit = formatNumberToVolume(
    extentProductInUnit,
    LongUnitToShortUnitMap[dataset.dataSource.scale.unit],
  );

  const renderDSExtentTooltip = () => {
    return (
      <div>
        Dataset extent:
        <br />
        {formatVoxels(extentProductInVx)}
        <br />
        {formattedExtentInUnit}
      </div>
    );
  };

  const copyExtentToClipboard = () => {
    const { width, height, depth } = getDatasetExtentInVoxel(dataset);
    copyToClipboard(`${width},${height},${depth}`, "dataset extent", true);
  };

  return (
    <FastTooltip
      dynamicRenderer={renderDSExtentTooltip}
      placement="left"
      wrapper="tr"
      key={dataset.id}
    >
      <td
        style={{
          paddingRight: 20,
          paddingTop: 10,
        }}
      >
        <Icon component={IconExtent} className="info-tab-icon" aria-label="Dataset extent" />
      </td>
      <td
        style={{
          paddingTop: 10,
        }}
        onClick={copyExtentToClipboard}
      >
        {extentInVoxel}
        <br /> {extentInLength}
      </td>
    </FastTooltip>
  );
}
