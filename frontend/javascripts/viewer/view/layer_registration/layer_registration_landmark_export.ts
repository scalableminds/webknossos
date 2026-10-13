import saveAs from "file-saver";
import { transformToCSVRow } from "viewer/model/helpers/csv_helpers";
import type { CompleteLandmarkPair, LayerNames, Side } from "./layer_registration_helpers";

// The formats in which the landmarks can be downloaded. Both can be uploaded in the dataset
// composition wizard (see admin/dataset/composition_wizard/02_upload_files.tsx).
export type LandmarkExportFormat = "csv" | "nml";

// The landmark pairs in the CSV format of BigWarp: one line per pair with the name, whether
// the pair is enabled, the position in the moving layer and the position in the fixed layer.
// The composition wizard transforms the first position of each line onto the second.
export function getLandmarksAsBigWarpCsv(pairs: CompleteLandmarkPair[]): string {
  return pairs
    .map(({ pairId, fixed, moving }) =>
      transformToCSVRow([`Pt-${pairId}`, true, ...moving.position, ...fixed.position]),
    )
    .join("\n");
}

export function saveTextFile(text: string, fileName: string) {
  saveAs(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName);
}

function getFileNameBase(layerNames: LayerNames): string {
  return `landmarks_${layerNames.moving}_to_${layerNames.fixed}`;
}

export function getBigWarpCsvFileName(layerNames: LayerNames): string {
  return `${getFileNameBase(layerNames)}.csv`;
}

// The composition wizard expects two NML files and transforms the landmarks of the first one
// onto those of the second, so the moving layer comes first.
export function getNmlFileName(layerNames: LayerNames, side: Side): string {
  return side === "moving"
    ? `${getFileNameBase(layerNames)}_1_moving_${layerNames.moving}.nml`
    : `${getFileNameBase(layerNames)}_2_fixed_${layerNames.fixed}.nml`;
}
