import { computeHash } from "libs/utils";
import type { DataLayer, DatasourceConfiguration } from "types/schemas/datasource.types";

export type RemoteStorage = "s3" | "gs" | "https" | "file";

export const SUPPORTED_FORMATS = [
  "OME-Zarr",
  "Zarr",
  "Zarr3",
  "N5",
  "Neuroglancer Precomputed",
] as const;
export type RemoteFormat = (typeof SUPPORTED_FORMATS)[number];

const NEUROGLANCER_SCHEME = /^(zarr3?|n5|precomputed):\/\//i;

export const STORAGE_LABELS: Record<RemoteStorage, string> = {
  s3: "Amazon S3",
  gs: "Google Cloud Storage",
  https: "HTTPS",
  file: "Local file system",
};

// Only a client-side hint while typing. The explore call on the backend stays the source of truth.
export function detectStorage(url: string): RemoteStorage | null {
  const bareUrl = url.trim().replace(NEUROGLANCER_SCHEME, "").toLowerCase();
  if (bareUrl.startsWith("https://") || bareUrl.startsWith("http://")) return "https";
  if (bareUrl.startsWith("s3://")) return "s3";
  if (bareUrl.startsWith("gs://")) return "gs";
  if (bareUrl.startsWith("file://")) return "file";
  return null;
}

export function detectFormat(url: string): RemoteFormat | null {
  const lowerUrl = url.trim().toLowerCase();
  if (lowerUrl.includes(".ome.zarr")) return "OME-Zarr";
  if (lowerUrl.startsWith("zarr3://")) return "Zarr3";
  if (lowerUrl.startsWith("zarr://") || /\.zarr\/?$/.test(lowerUrl)) return "Zarr";
  if (lowerUrl.startsWith("n5://") || /\.n5\/?$/.test(lowerUrl)) return "N5";
  if (lowerUrl.startsWith("precomputed://")) return "Neuroglancer Precomputed";
  return null;
}

const DATA_FORMAT_LABELS: Record<DataLayer["dataFormat"], RemoteFormat | "WKW"> = {
  zarr: "Zarr",
  zarr3: "Zarr3",
  n5: "N5",
  neuroglancerPrecomputed: "Neuroglancer Precomputed",
  wkw: "WKW",
};

export function getLayerFormatLabel(layer: DataLayer, sourceUrl: string): string {
  const isZarr = layer.dataFormat === "zarr" || layer.dataFormat === "zarr3";
  // The datasource does not tell OME-Zarr apart from plain Zarr, so the URL fills that gap.
  if (isZarr && detectFormat(sourceUrl) === "OME-Zarr") return "OME-Zarr";
  return DATA_FORMAT_LABELS[layer.dataFormat] ?? layer.dataFormat;
}

// Turns e.g. s3://bucket/em/cortex_l4.ome.zarr/ into cortex_l4.
export function getDatasetNameFromUrl(url: string): string {
  const lastPathElement = url
    .trim()
    .split(/[^a-zA-Z\d_\-.~]/) // split by non url-safe characters
    .filter((element) => element !== "")
    .at(-1);
  return (lastPathElement ?? "").replace(/(\.ome)?\.(zarr|n5)$/i, "");
}

// Used when a URL is imported without user interaction, so that two imports of datasets
// with the same folder name don't collide.
export function getUniqueDatasetNameFromUrl(url: string): string {
  return `${getDatasetNameFromUrl(url)}-${computeHash(url)}`;
}

export const mergeNewLayers = (
  existingDatasource: DatasourceConfiguration | null | undefined,
  newDatasource: DatasourceConfiguration,
): DatasourceConfiguration => {
  if (existingDatasource?.dataLayers == null) {
    return newDatasource;
  }

  // Keep existing layer names; only rename incoming layers if a collision occurs.
  const taken = new Set(existingDatasource.dataLayers.map((l) => l.name));
  const uniquify = (base: string) => {
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    let i = 2;
    while (taken.has(`${base}_${i}`)) i += 1;
    const unique = `${base}_${i}`;
    taken.add(unique);
    return unique;
  };
  const newUnique = newDatasource.dataLayers.map((l) => ({ ...l, name: uniquify(l.name) }));
  return {
    ...existingDatasource,
    dataLayers: existingDatasource.dataLayers.concat(newUnique),
  };
};

export type ExploreErrorKind = "protocol" | "access" | "notFound" | "noData" | "request";

export type ExploreError = {
  kind: ExploreErrorKind;
  // The explore report of the backend, if there is one.
  report: string | null;
  // Whether credentials were sent with the explore request.
  withCredentials: boolean;
  // Set for errors the backend didn't explain in a report, e.g. a failed request.
  message?: string;
};

export function classifyExploreReport(report: string): ExploreErrorKind {
  if (/401 Unauthorized|403 Forbidden|Access Denied/i.test(report)) return "access";
  if (/404|Not Found|NoSuchBucket|NoSuchKey/i.test(report)) return "notFound";
  return "noData";
}
