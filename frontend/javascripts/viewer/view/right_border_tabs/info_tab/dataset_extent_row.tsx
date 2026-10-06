import { copyToClipboard } from "libs/clipboard";
import { formatExtentInUnitWithLength } from "libs/format_utils";
import type { APIDataset } from "types/api_types";
import {
  getDatasetExtentAsString,
  getDatasetExtentInVoxel,
} from "viewer/model/accessors/dataset_accessor";
import { InfoTabRow, InfoTabUnit } from "./info_tab_layout";

export function DatasetExtentRow({ dataset }: { dataset: APIDataset }) {
  const extentInVoxel = getDatasetExtentInVoxel(dataset);
  const extentInVoxelAsString = formatExtentInUnitWithLength(extentInVoxel, (x) => `${x}`);
  // The second line states the same extent in physical length, hence no unit of its own here.
  const extentInLength = getDatasetExtentAsString(dataset, false);

  const copyExtentToClipboard = () => {
    const { width, height, depth } = extentInVoxel;
    copyToClipboard(`${width},${height},${depth}`, "dataset extent", true);
  };

  return (
    <InfoTabRow
      label="Extent"
      tooltip="Click to copy the dataset extent"
      onClick={copyExtentToClipboard}
    >
      <span>
        {extentInVoxelAsString}
        <InfoTabUnit>vx</InfoTabUnit>
      </span>
      <span className="info-tab-row-secondary-value">{extentInLength}</span>
    </InfoTabRow>
  );
}
