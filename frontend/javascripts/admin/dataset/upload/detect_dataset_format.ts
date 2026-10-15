import { formatBytes } from "libs/format_utils";
import { getFileExtension, pluralize } from "libs/utils";

// The format of the selected upload, inferred purely from file names and the folder structure.
// File contents are never read, so data types, voxel sizes etc. are unknown at this point.
export type DetectedDatasetFormat =
  // Can be viewed right away (WKW, Zarr, N5, …). layerNames is empty if no layers could be told apart.
  | { kind: "native"; formatName: string; layerNames: string[] }
  // A sequence of 2D images, one stack per folder.
  | { kind: "imageStack"; formatName: string; sliceCount: number; layerCount: number }
  // One or more single-file volumes (CZI, IMS, NIfTI, a single TIFF, …).
  | { kind: "imageFiles"; formatName: string; fileCount: number }
  | { kind: "unknown" };

export type SelectionSummary = {
  kind: "folder" | "archive" | "files";
  title: string;
  subtitle: string;
};

// Checked in this order; the first match wins.
const NATIVE_FORMATS: Array<{ formatName: string; isMarker: (baseName: string) => boolean }> = [
  { formatName: "WEBKNOSSOS dataset", isMarker: (name) => name === "datasource-properties.json" },
  { formatName: "WKW", isMarker: (name) => getFileExtension(name) === "wkw" },
  { formatName: "Zarr 3", isMarker: (name) => name === "zarr.json" },
  { formatName: "Zarr", isMarker: (name) => [".zarray", ".zattrs", ".zgroup"].includes(name) },
  { formatName: "N5", isMarker: (name) => name === "attributes.json" },
  { formatName: "Neuroglancer Precomputed", isMarker: (name) => name === "info" },
];

const STACKABLE_IMAGE_FORMATS: Record<string, string> = {
  tif: "TIFF",
  tiff: "TIFF",
  png: "PNG",
  jpg: "JPEG",
  jpeg: "JPEG",
  dm3: "DM3/DM4",
  dm4: "DM3/DM4",
};

const SINGLE_FILE_IMAGE_FORMATS: Record<string, string> = {
  czi: "CZI",
  ims: "IMS",
  nii: "NIfTI",
  nifti: "NIfTI",
};

const ARCHIVE_EXTENSIONS = ["zip", "ozx"];

// Folder names of magnifications (1, 2-2-1, s0) or precomputed scales (8_8_40) are no layers.
const MAG_DIRECTORY_REGEX = /^(s?\d+|[\d]+([-_x][\d.]+)+)$/;

function splitPath(path: string): string[] {
  return path.replace(/^\.?\/+/, "").split(/[\\/]/);
}

function getBaseName(path: string): string {
  const segments = splitPath(path);
  return segments[segments.length - 1];
}

function getParentDirectory(path: string): string {
  return splitPath(path).slice(0, -1).join("/");
}

function getImageExtension(baseName: string): string {
  const lowerCaseName = baseName.toLowerCase();
  return lowerCaseName.endsWith(".nii.gz") ? "nii" : getFileExtension(lowerCaseName);
}

function getCommonDirectory(paths: string[]): string[] {
  const directories = paths.map((path) => splitPath(path).slice(0, -1));
  const [first, ...rest] = directories;
  let commonLength = first.length;
  for (const directory of rest) {
    let index = 0;
    while (index < commonLength && directory[index] === first[index]) index++;
    commonLength = index;
  }
  return first.slice(0, commonLength);
}

function getNativeLayerNames(paths: string[], markerPaths: string[]): string[] {
  const datasourcePropertiesPath = markerPaths.find(
    (path) => getBaseName(path) === "datasource-properties.json",
  );
  const rootDirectory =
    datasourcePropertiesPath != null
      ? splitPath(datasourcePropertiesPath).slice(0, -1)
      : getCommonDirectory(paths);

  const layerNames = new Set<string>();
  for (const markerPath of markerPaths) {
    const segments = splitPath(markerPath);
    const isBelowRoot = rootDirectory.every((segment, index) => segments[index] === segment);
    // The marker has to sit in a subfolder of the root (and not in the root itself).
    if (!isBelowRoot || segments.length < rootDirectory.length + 2) continue;
    const childName = segments[rootDirectory.length];
    if (!childName.startsWith(".") && !MAG_DIRECTORY_REGEX.test(childName)) {
      layerNames.add(childName);
    }
  }
  return Array.from(layerNames).sort();
}

// OME-Zarr (v0.4) stores its multiscales metadata in the .zattrs of the top-most Zarr group.
function isOmeZarr(zarrMarkerPaths: string[]): boolean {
  const minDepth = Math.min(...zarrMarkerPaths.map((path) => splitPath(path).length));
  return zarrMarkerPaths.some(
    (path) => splitPath(path).length === minDepth && getBaseName(path) === ".zattrs",
  );
}

export function detectDatasetFormat(paths: string[]): DetectedDatasetFormat {
  const visiblePaths = paths.filter((path) => {
    const baseName = getBaseName(path);
    return baseName !== "" && baseName !== ".DS_Store" && baseName !== "Thumbs.db";
  });

  const allMarkerPaths = visiblePaths.filter((path) =>
    NATIVE_FORMATS.some(({ isMarker }) => isMarker(getBaseName(path))),
  );
  for (const { formatName, isMarker } of NATIVE_FORMATS) {
    const markerPaths = allMarkerPaths.filter((path) => isMarker(getBaseName(path)));
    if (markerPaths.length > 0) {
      return {
        kind: "native",
        formatName: formatName === "Zarr" && isOmeZarr(markerPaths) ? "OME-Zarr" : formatName,
        layerNames: getNativeLayerNames(visiblePaths, allMarkerPaths),
      };
    }
  }

  const imagePaths = visiblePaths.filter(
    (path) => getImageExtension(getBaseName(path)) in STACKABLE_IMAGE_FORMATS,
  );
  const singleFilePaths = visiblePaths.filter(
    (path) => getImageExtension(getBaseName(path)) in SINGLE_FILE_IMAGE_FORMATS,
  );

  if (imagePaths.length > 1 && singleFilePaths.length === 0) {
    const formatNames = new Set(
      imagePaths.map((path) => STACKABLE_IMAGE_FORMATS[getImageExtension(getBaseName(path))]),
    );
    return {
      kind: "imageStack",
      formatName: formatNames.size === 1 ? Array.from(formatNames)[0] : "image",
      sliceCount: imagePaths.length,
      layerCount: new Set(imagePaths.map(getParentDirectory)).size,
    };
  }

  const volumePaths = [...singleFilePaths, ...imagePaths];
  if (volumePaths.length > 0) {
    const formatNames = new Set(
      volumePaths.map((path) => {
        const extension = getImageExtension(getBaseName(path));
        return SINGLE_FILE_IMAGE_FORMATS[extension] ?? STACKABLE_IMAGE_FORMATS[extension];
      }),
    );
    return {
      kind: "imageFiles",
      formatName: formatNames.size === 1 ? Array.from(formatNames)[0] : "image",
      fileCount: volumePaths.length,
    };
  }

  return { kind: "unknown" };
}

export function isArchive(path: string): boolean {
  return ARCHIVE_EXTENSIONS.includes(getFileExtension(path));
}

export function containsAnnotationFile(paths: string[]): boolean {
  return paths.some((path) => getFileExtension(path) === "nml");
}

function getStem(baseName: string): string {
  const lowerCaseName = baseName.toLowerCase();
  if (lowerCaseName.endsWith(".nii.gz")) return baseName.slice(0, -".nii.gz".length);
  const lastDotIndex = baseName.lastIndexOf(".");
  return lastDotIndex > 0 ? baseName.slice(0, lastDotIndex) : baseName;
}

function getTopLevelFolder(paths: string[]): string | null {
  const firstSegments = new Set(paths.map((path) => splitPath(path)[0]));
  const allNested = paths.every((path) => splitPath(path).length > 1);
  return firstSegments.size === 1 && allNested ? Array.from(firstSegments)[0] : null;
}

function getCommonPrefix(strings: string[]): string {
  return strings.reduce((prefix, string) => {
    let index = 0;
    while (index < prefix.length && prefix[index] === string[index]) index++;
    return prefix.slice(0, index);
  });
}

export function sanitizeDatasetName(name: string): string {
  return name
    .replace(/[^0-9a-zA-Z_.-]/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_");
}

// Proposes a dataset name: the dropped folder or archive, otherwise the shared prefix
// of the file names (e.g. "slice" for slice_0001.tif … slice_0142.tif).
export function inferDatasetName(paths: string[]): string {
  if (paths.length === 0) return "";
  const topLevelFolder = getTopLevelFolder(paths);
  if (topLevelFolder != null) return sanitizeDatasetName(topLevelFolder);

  const stems = paths.map((path) => getStem(getBaseName(path))).sort();
  const commonPrefix = getCommonPrefix(stems).replace(/[\s_.-]*\d*$/, "");
  return sanitizeDatasetName(commonPrefix.length >= 3 ? commonPrefix : stems[0]);
}

export function summarizeSelection(files: Array<{ path?: string; name: string; size: number }>) {
  const paths = files.map((file) => file.path || file.name);
  const totalSize = formatBytes(
    files.reduce((sum, file) => sum + file.size, 0),
    1,
  );
  const fileCount = `${files.length.toLocaleString()} ${pluralize("file", files.length)}`;

  if (files.length === 1 && isArchive(paths[0])) {
    return {
      kind: "archive",
      title: files[0].name,
      subtitle: `${getFileExtension(files[0].name).toUpperCase()} archive · ${totalSize}`,
    } satisfies SelectionSummary;
  }

  const topLevelFolder = getTopLevelFolder(paths);
  if (topLevelFolder != null) {
    return {
      kind: "folder",
      title: `${topLevelFolder}/`,
      subtitle: `${fileCount} · ${totalSize}`,
    } satisfies SelectionSummary;
  }

  const sortedNames = paths.map(getBaseName).sort();
  const allImages = sortedNames.every((name) => {
    const extension = getImageExtension(name);
    return extension in STACKABLE_IMAGE_FORMATS || extension in SINGLE_FILE_IMAGE_FORMATS;
  });
  const nameRange =
    sortedNames.length === 1
      ? sortedNames[0]
      : sortedNames.length === 2
        ? sortedNames.join(", ")
        : `${sortedNames[0]} … ${sortedNames[sortedNames.length - 1]}`;
  return {
    kind: "files",
    title: allImages
      ? `${files.length.toLocaleString()} image ${pluralize("file", files.length)}`
      : fileCount,
    subtitle: `${nameRange} · ${totalSize}`,
  } satisfies SelectionSummary;
}
