import { formatExtentInUnitWithLength } from "libs/format_utils";
import { pluralize } from "libs/utils";
import type { FileWithPath } from "react-dropzone";
import type { APIDataLayer } from "types/api_types";
import { detectDatasetFormat, summarizeSelection } from "./detect_dataset_format";

export type UploadLayerProgress = { name: string; bytes: number; sentBytes: number };

/** A row of the layer list. Sizes are only known for uploaded layers. */
export type LayerRow = {
  name: string;
  bytes: number | null;
  sentBytes: number | null;
  category?: APIDataLayer["category"];
  // E.g. "uint8 · 2048 × 2048 × 512 vx · 6 mags · Zarr"
  details?: string;
};

const DATA_FORMAT_NAMES: Record<string, string> = {
  wkw: "WKW",
  zarr: "Zarr",
  zarr3: "Zarr 3",
  n5: "N5",
  neuroglancerPrecomputed: "Neuroglancer Precomputed",
};

export type UploadLayerGroups = {
  layers: UploadLayerProgress[];
  // Files outside of a layer folder (e.g. datasource-properties.json) are missing here.
  layerIndexByFile: Map<File, number>;
};

// The subset of a ResumableFile that is needed to compute the progress.
type FileUploadProgress = { file: File; size: number; progress: () => number };

function getPathSegments(file: FileWithPath): string[] {
  return (file.path || file.name).replace(/^\.?\/+/, "").split(/[\\/]/);
}

/**
 * Groups the files of an upload by the layer they belong to. Only native formats have layer
 * folders, so all other uploads (archives, image stacks, …) form a single group that is named
 * after the selection.
 */
export function groupFilesByLayer(files: FileWithPath[]): UploadLayerGroups {
  const format = detectDatasetFormat(files.map((file) => file.path || file.name));
  const layerNames = format.kind === "native" ? format.layerNames : [];

  if (layerNames.length === 0) {
    const bytes = files.reduce((sum, file) => sum + file.size, 0);
    return {
      layers: [{ name: summarizeSelection(files).title, bytes, sentBytes: 0 }],
      layerIndexByFile: new Map(files.map((file) => [file as File, 0])),
    };
  }

  const layers = layerNames.map((name) => ({ name, bytes: 0, sentBytes: 0 }));
  const layerIndexByName = new Map(layerNames.map((name, index) => [name, index]));
  const layerIndexByFile = new Map<File, number>();
  for (const file of files) {
    // The last segment is the file name, which can't be a layer folder.
    const layerIndex = getPathSegments(file)
      .slice(0, -1)
      .map((segment) => layerIndexByName.get(segment))
      .find((index) => index != null);
    if (layerIndex == null) continue;
    layers[layerIndex].bytes += file.size;
    layerIndexByFile.set(file as File, layerIndex);
  }
  return { layers, layerIndexByFile };
}

/**
 * Sums the bytes sent per layer and in total in a single pass over all files, since this runs
 * repeatedly during the upload and there can be many files.
 */
export function getUploadProgress(
  { layers, layerIndexByFile }: UploadLayerGroups,
  fileProgresses: FileUploadProgress[],
): { bytesSent: number; layers: UploadLayerProgress[] } {
  let bytesSent = 0;
  const sentBytesPerLayer = layers.map(() => 0);
  for (const fileProgress of fileProgresses) {
    const fileBytesSent = fileProgress.progress() * fileProgress.size;
    bytesSent += fileBytesSent;
    const layerIndex = layerIndexByFile.get(fileProgress.file);
    if (layerIndex != null) sentBytesPerLayer[layerIndex] += fileBytesSent;
  }
  return {
    bytesSent,
    layers: layers.map((layer, index) => ({ ...layer, sentBytes: sentBytesPerLayer[index] })),
  };
}

function describeDataLayer(layer: APIDataLayer): string {
  // The API type is narrower than the formats the server actually supports.
  const dataFormat: string | undefined = layer.dataFormat;
  return [
    layer.elementClass,
    `${formatExtentInUnitWithLength(layer.boundingBox, String)} vx`,
    `${layer.mags.length} ${pluralize("mag", layer.mags.length)}`,
    dataFormat != null ? (DATA_FORMAT_NAMES[dataFormat] ?? dataFormat) : null,
  ]
    .filter((part) => part != null)
    .join(" · ");
}

/**
 * Lists the layers of a dataset as the server sees them. Uploaded layers keep their size, if the
 * upload could tell them apart. Converted uploads have different layers than were uploaded.
 */
export function getDatasetLayerRows(
  dataLayers: APIDataLayer[],
  uploadedLayers: UploadLayerProgress[],
): LayerRow[] {
  const uploadedBytesByName = new Map(uploadedLayers.map((layer) => [layer.name, layer.bytes]));
  return dataLayers.map((layer) => {
    const bytes = uploadedBytesByName.get(layer.name) ?? null;
    return {
      name: layer.name,
      bytes,
      sentBytes: bytes,
      category: layer.category,
      details: describeDataLayer(layer),
    };
  });
}

export function markLayersAsSent(layers: UploadLayerProgress[]): UploadLayerProgress[] {
  return layers.map((layer) => ({ ...layer, sentBytes: layer.bytes }));
}
