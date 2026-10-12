import saveAs from "file-saver";
import zip from "lodash-es/zip";
import { transformToCSVRow } from "viewer/model/helpers/csv_helpers";
import type { Landmark, LayerNames, Side } from "./alignment_helpers";

// The formats in which the landmarks can be downloaded. Both can be uploaded in the dataset
// composition wizard (see admin/dataset/composition_wizard/02_upload_files.tsx).
export type LandmarkExportFormat = "csv" | "nml";

// The landmark pairs in the CSV format of BigWarp: one line per pair with the name, whether
// the pair is enabled, the position in the moving layer and the position in the fixed layer.
// The composition wizard transforms the first position of each line onto the second.
// Landmarks without a partner are left out.
export function getLandmarksAsBigWarpCsv(landmarks: Record<Side, Landmark[]>): string {
  return zip(landmarks.B, landmarks.A)
    .flatMap(([landmarkB, landmarkA], index) =>
      landmarkB != null && landmarkA != null
        ? [transformToCSVRow([`Pt-${index}`, true, ...landmarkB.position, ...landmarkA.position])]
        : [],
    )
    .join("\n");
}

export function saveTextFile(text: string, fileName: string) {
  saveAs(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName);
}

function getFileNameBase(layerNames: LayerNames): string {
  return `landmarks_${layerNames.B}_to_${layerNames.A}`;
}

export function getBigWarpCsvFileName(layerNames: LayerNames): string {
  return `${getFileNameBase(layerNames)}.csv`;
}

// The composition wizard expects two NML files and transforms the landmarks of the first one
// onto those of the second, so the moving layer comes first.
export function getNmlFileName(layerNames: LayerNames, side: Side): string {
  return side === "B"
    ? `${getFileNameBase(layerNames)}_1_moving_${layerNames.B}.nml`
    : `${getFileNameBase(layerNames)}_2_fixed_${layerNames.A}.nml`;
}
