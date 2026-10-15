import { formatBytes } from "libs/format_utils";
import { getFileExtension, pluralize } from "libs/utils";

// Mirrors the validation rule of the dataset name form field.
const MIN_DATASET_NAME_LENGTH = 3;

// The format of the selected upload, inferred purely from file names and the folder structure.
// File contents are never read, so data types, voxel sizes etc. are unknown at this point.
export type DetectedDatasetFormat =
  // Can be viewed right away (WKW, Zarr, N5, …). layerNames is empty if no layers could be told apart.
  | { kind: "native"; formatName: string; layerNames: string[] }
  // A sequence of 2D images, one stack per folder.
  | { kind: "imageStack"; formatName: string; sliceCount: number; layerCount: number }
  // One or more single-file volumes (CZI, IMS, a single TIFF, …).
  | { kind: "imageFiles"; formatName: string; fileCount: number }
  | { kind: "unknown" };

export type SelectionSummary = {
  kind: "folder" | "archive" | "files";
  title: string;
  subtitle: string;
};

type ParsedPath = { segments: string[]; baseName: string; stem: string; extension: string };

// Checked in this order; the first match wins.
const NATIVE_FORMATS: Array<{ formatName: string; isMarker: (file: ParsedPath) => boolean }> = [
  {
    formatName: "WEBKNOSSOS dataset",
    isMarker: (file) => file.baseName === "datasource-properties.json",
  },
  { formatName: "WKW", isMarker: (file) => file.extension === "wkw" },
  { formatName: "Zarr 3", isMarker: (file) => file.baseName === "zarr.json" },
  {
    formatName: "Zarr",
    isMarker: (file) => [".zarray", ".zattrs", ".zgroup"].includes(file.baseName),
  },
  { formatName: "N5", isMarker: (file) => file.baseName === "attributes.json" },
  { formatName: "Neuroglancer Precomputed", isMarker: (file) => file.baseName === "info" },
];

// Image formats that can be converted, by file extension. Stackable formats contain 2D slices
// which form a 3D stack when several of them are selected. The others are volumes on their own.
const IMAGE_FORMATS = new Map<string, { formatName: string; isStackable: boolean }>([
  ["tif", { formatName: "TIFF", isStackable: true }],
  ["tiff", { formatName: "TIFF", isStackable: true }],
  ["png", { formatName: "PNG", isStackable: true }],
  ["jpg", { formatName: "JPEG", isStackable: true }],
  ["jpeg", { formatName: "JPEG", isStackable: true }],
  ["dm3", { formatName: "DM3/DM4", isStackable: true }],
  ["dm4", { formatName: "DM3/DM4", isStackable: true }],
  ["czi", { formatName: "CZI", isStackable: false }],
  ["ims", { formatName: "IMS", isStackable: false }],
]);

// .ozx is a zipped OME-Zarr.
const ARCHIVE_EXTENSIONS = ["zip", "ozx"];

const IGNORED_FILE_NAMES = ["", ".DS_Store", "Thumbs.db"];

// Folder names of magnifications (1, 2-2-1, s0) or precomputed scales (8_8_40) are no layers.
const MAG_DIRECTORY_REGEX = /^(s?\d+|[\d]+([-_x][\d.]+)+)$/;

function splitExtension(baseName: string): { stem: string; extension: string } {
  // A leading dot (e.g. .zattrs) marks a hidden file, not an extension.
  const lastDotIndex = baseName.lastIndexOf(".");
  return lastDotIndex > 0
    ? {
        stem: baseName.slice(0, lastDotIndex),
        extension: baseName.slice(lastDotIndex + 1).toLowerCase(),
      }
    : { stem: baseName, extension: "" };
}

function parsePath(path: string): ParsedPath {
  const segments = path.replace(/^\.?\/+/, "").split(/[\\/]/);
  const baseName = segments[segments.length - 1];
  return { segments, baseName, ...splitExtension(baseName) };
}

function getCommonDirectory(files: ParsedPath[]): string[] {
  const [first, ...rest] = files.map((file) => file.segments.slice(0, -1));
  let commonLength = first.length;
  for (const directory of rest) {
    let index = 0;
    while (index < commonLength && directory[index] === first[index]) index++;
    commonLength = index;
  }
  return first.slice(0, commonLength);
}

function getNativeLayerNames(files: ParsedPath[], markerFiles: ParsedPath[]): string[] {
  const datasourceProperties = markerFiles.find(
    (file) => file.baseName === "datasource-properties.json",
  );
  let rootDirectory: string[];
  if (datasourceProperties != null) {
    rootDirectory = datasourceProperties.segments.slice(0, -1);
  } else {
    rootDirectory = getCommonDirectory(files);
    // For a single layer with a single magnification, the common directory is the
    // magnification folder (e.g. color/1 containing the WKW bucket folders z0, z1, …).
    while (
      rootDirectory.length > 0 &&
      MAG_DIRECTORY_REGEX.test(rootDirectory[rootDirectory.length - 1])
    ) {
      rootDirectory = rootDirectory.slice(0, -1);
    }
  }

  const layerNames = new Set<string>();
  for (const { segments } of markerFiles) {
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
function isOmeZarr(zarrMarkerFiles: ParsedPath[]): boolean {
  const minDepth = zarrMarkerFiles.reduce(
    (depth, file) => Math.min(depth, file.segments.length),
    Number.POSITIVE_INFINITY,
  );
  return zarrMarkerFiles.some(
    (file) => file.segments.length === minDepth && file.baseName === ".zattrs",
  );
}

function getImageFormatName(imageFiles: ParsedPath[]): string {
  const formatNames = new Set(
    imageFiles.map((file) => IMAGE_FORMATS.get(file.extension)?.formatName),
  );
  return formatNames.size === 1 ? (Array.from(formatNames)[0] ?? "image") : "image";
}

export function detectDatasetFormat(paths: string[]): DetectedDatasetFormat {
  const files = paths.map(parsePath).filter((file) => !IGNORED_FILE_NAMES.includes(file.baseName));

  const markerFiles = files.filter((file) => NATIVE_FORMATS.some(({ isMarker }) => isMarker(file)));
  const nativeFormat = NATIVE_FORMATS.find(({ isMarker }) => markerFiles.some(isMarker));
  if (nativeFormat != null) {
    const isOme =
      nativeFormat.formatName === "Zarr" && isOmeZarr(markerFiles.filter(nativeFormat.isMarker));
    return {
      kind: "native",
      formatName: isOme ? "OME-Zarr" : nativeFormat.formatName,
      layerNames: getNativeLayerNames(files, markerFiles),
    };
  }

  const imageFiles = files.filter((file) => IMAGE_FORMATS.has(file.extension));
  const areAllStackable = imageFiles.every(
    (file) => IMAGE_FORMATS.get(file.extension)?.isStackable,
  );
  if (imageFiles.length > 1 && areAllStackable) {
    return {
      kind: "imageStack",
      formatName: getImageFormatName(imageFiles),
      sliceCount: imageFiles.length,
      layerCount: new Set(imageFiles.map((file) => file.segments.slice(0, -1).join("/"))).size,
    };
  }
  if (imageFiles.length > 0) {
    return {
      kind: "imageFiles",
      formatName: getImageFormatName(imageFiles),
      fileCount: imageFiles.length,
    };
  }

  return { kind: "unknown" };
}

export function isImageFile(path: string): boolean {
  return IMAGE_FORMATS.has(parsePath(path).extension);
}

export function isArchive(path: string): boolean {
  return ARCHIVE_EXTENSIONS.includes(getFileExtension(path));
}

export function containsAnnotationFile(paths: string[]): boolean {
  return paths.some((path) => getFileExtension(path) === "nml");
}

export function getTotalFileSize(files: Array<{ size: number }>): number {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function getTopLevelFolder(files: ParsedPath[]): string | null {
  const firstSegment = files[0].segments[0];
  const isShared = files.every(
    ({ segments }) => segments.length > 1 && segments[0] === firstSegment,
  );
  return isShared ? firstSegment : null;
}

function getCommonPrefix(strings: string[]): string {
  return strings.reduce((prefix, string) => {
    let index = 0;
    while (index < prefix.length && prefix[index] === string[index]) index++;
    return prefix.slice(0, index);
  });
}

function sanitizeDatasetName(name: string): string {
  return name
    .replace(/[^0-9a-zA-Z_.-]/g, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_");
}

// Proposes a dataset name: the dropped folder or file (e.g. an archive), otherwise the shared
// prefix of the file names without slice numbers (e.g. "slice" for slice_0001.tif … slice_0142.tif).
// Returns an empty string if no name of the minimum length can be inferred.
export function inferDatasetName(paths: string[]): string {
  if (paths.length === 0) return "";
  const files = paths.map(parsePath);
  const topLevelFolder = getTopLevelFolder(files);
  const name =
    topLevelFolder ??
    (files.length === 1
      ? files[0].stem
      : getCommonPrefix(files.map((file) => file.stem)).replace(/[\s_.-]*\d*$/, ""));
  const sanitizedName = sanitizeDatasetName(name);
  return sanitizedName.length >= MIN_DATASET_NAME_LENGTH ? sanitizedName : "";
}

export function summarizeSelection(files: Array<{ path?: string; name: string; size: number }>) {
  const parsedPaths = files.map((file) => parsePath(file.path || file.name));
  const totalSize = formatBytes(getTotalFileSize(files), 1);
  const fileCount = `${files.length.toLocaleString()} ${pluralize("file", files.length)}`;

  if (files.length === 1 && ARCHIVE_EXTENSIONS.includes(parsedPaths[0].extension)) {
    return {
      kind: "archive",
      title: files[0].name,
      subtitle: `${parsedPaths[0].extension.toUpperCase()} archive · ${totalSize}`,
    } satisfies SelectionSummary;
  }

  const topLevelFolder = getTopLevelFolder(parsedPaths);
  if (topLevelFolder != null) {
    return {
      kind: "folder",
      title: `${topLevelFolder}/`,
      subtitle: `${fileCount} · ${totalSize}`,
    } satisfies SelectionSummary;
  }

  let firstName = parsedPaths[0].baseName;
  let lastName = firstName;
  for (const { baseName } of parsedPaths) {
    if (baseName < firstName) firstName = baseName;
    if (baseName > lastName) lastName = baseName;
  }
  const allImages = parsedPaths.every((file) => IMAGE_FORMATS.has(file.extension));
  const nameRange =
    files.length === 1
      ? firstName
      : files.length === 2
        ? `${firstName}, ${lastName}`
        : `${firstName} … ${lastName}`;
  return {
    kind: "files",
    title: allImages
      ? `${files.length.toLocaleString()} image ${pluralize("file", files.length)}`
      : fileCount,
    subtitle: `${nameRange} · ${totalSize}`,
  } satisfies SelectionSummary;
}
