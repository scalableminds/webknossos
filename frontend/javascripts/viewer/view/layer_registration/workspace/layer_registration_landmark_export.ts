import saveAs from "file-saver";
import Toast from "libs/toast";
import { pluralize } from "libs/utils";
import { transformToCSVRow } from "viewer/model/helpers/csv_helpers";
import {
  type CompleteLandmarkPair,
  getCompleteLandmarkPairs,
  type Landmark,
  type LayerNames,
  SIDES,
  type Side,
} from "../helpers/layer_registration_helpers";
import type { SendMessage } from "./layer_registration_iframe_bridge";

// The formats in which the landmarks can be downloaded. Both can be uploaded in the dataset
// composition wizard (see admin/dataset/composition_wizard/02_upload_files.tsx).
export type LandmarkExportFormat = "csv" | "nml";

// The landmark pairs in the CSV format of BigWarp: one line per pair with the name, whether
// the pair is enabled, the position in the moving layer and the position in the fixed layer.
// The composition wizard transforms the first position of each line onto the second.
function getLandmarksAsBigWarpCsv(pairs: CompleteLandmarkPair[]): string {
  return pairs
    .map(({ pairId, fixed, moving }) =>
      transformToCSVRow([`Pt-${pairId}`, true, ...moving.position, ...fixed.position]),
    )
    .join("\n");
}

function saveTextFile(text: string, fileName: string) {
  saveAs(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName);
}

function getFileNameBase(layerNames: LayerNames): string {
  return `landmarks_${layerNames.moving}_to_${layerNames.fixed}`;
}

function getBigWarpCsvFileName(layerNames: LayerNames): string {
  return `${getFileNameBase(layerNames)}.csv`;
}

// The composition wizard expects two NML files and transforms the landmarks of the first one
// onto those of the second, so the moving layer comes first.
function getNmlFileName(layerNames: LayerNames, side: Side): string {
  return side === "moving"
    ? `${getFileNameBase(layerNames)}_1_moving_${layerNames.moving}.nml`
    : `${getFileNameBase(layerNames)}_2_fixed_${layerNames.fixed}.nml`;
}

// The workers serialize the landmark trees, because they have the full trees.
async function saveNmlFiles(
  pairs: CompleteLandmarkPair[],
  layerNames: LayerNames,
  sendMessage: SendMessage,
) {
  // Both files are read before saving any, so that a failure doesn't leave only one.
  const [fixedNmlString, movingNmlString] = await Promise.all(
    SIDES.map((side) =>
      sendMessage(
        side,
        "exportLandmarkPairsAsNml",
        pairs.map((pair) => [pair.pairId, pair[side].treeId]),
      ),
    ),
  );
  saveTextFile(fixedNmlString, getNmlFileName(layerNames, "fixed"));
  saveTextFile(movingNmlString, getNmlFileName(layerNames, "moving"));
}

// Downloads the complete landmark pairs in a format that the dataset composition wizard can
// import. Landmarks without a partner are left out, and a toast says how many.
export async function downloadLandmarkPairs(
  format: LandmarkExportFormat,
  landmarks: Record<Side, Landmark[]>,
  layerNames: LayerNames,
  sendMessage: SendMessage,
) {
  const pairs = getCompleteLandmarkPairs(landmarks);
  if (format === "csv") {
    saveTextFile(getLandmarksAsBigWarpCsv(pairs), getBigWarpCsvFileName(layerNames));
  } else {
    await saveNmlFiles(pairs, layerNames, sendMessage);
  }
  const leftOutCount = landmarks.fixed.length + landmarks.moving.length - 2 * pairs.length;
  if (leftOutCount > 0) {
    Toast.info(
      `Only complete pairs were downloaded. ${leftOutCount} ${pluralize("landmark", leftOutCount)} without a partner ${leftOutCount === 1 ? "was" : "were"} left out.`,
    );
  }
}
