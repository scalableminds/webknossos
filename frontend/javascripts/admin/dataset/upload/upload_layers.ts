import type { FileWithPath } from "react-dropzone";
import { detectDatasetFormat, summarizeSelection } from "./detect_dataset_format";

export type UploadLayerProgress = { name: string; bytes: number; sentBytes: number };

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

export function getLayerProgress(
  { layers, layerIndexByFile }: UploadLayerGroups,
  fileProgresses: FileUploadProgress[],
): UploadLayerProgress[] {
  const sentBytes = layers.map(() => 0);
  for (const fileProgress of fileProgresses) {
    const layerIndex = layerIndexByFile.get(fileProgress.file);
    if (layerIndex != null) sentBytes[layerIndex] += fileProgress.progress() * fileProgress.size;
  }
  return layers.map((layer, index) => ({ ...layer, sentBytes: sentBytes[index] }));
}

export function markLayersAsSent(layers: UploadLayerProgress[]): UploadLayerProgress[] {
  return layers.map((layer) => ({ ...layer, sentBytes: layer.bytes }));
}
