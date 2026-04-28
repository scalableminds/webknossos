import type { ResumableUpload } from "./resumable_upload";

// Helper functions
export function stopEvent(e: Event): void {
  e.stopPropagation();
  e.preventDefault();
}

export function generateUniqueIdentifier(file: File, _event?: Event): string {
  const relativePath = (file as any).webkitRelativePath || (file as any).relativePath || file.name;
  const size = file.size;

  return size + "-" + relativePath.replace(/[^0-9a-zA-Z_-]/gim, "");
}

export function formatSize(size: number | undefined): string {
  if (size === undefined) {
    return "n/a";
  }
  if (size < 1024) {
    return size + " bytes";
  } else if (size < 1024 * 1024) {
    return (size / 1024.0).toFixed(0) + " KB";
  } else if (size < 1024 * 1024 * 1024) {
    return (size / 1024.0 / 1024.0).toFixed(1) + " MB";
  } else {
    return (size / 1024.0 / 1024.0 / 1024.0).toFixed(1) + " GB";
  }
}

export function getTargetURI(
  resumable: ResumableUpload,
  request: string,
  params: Record<string, any>,
): string {
  let target = resumable.getOpt("target");
  const testTarget = resumable.getOpt("testTarget");

  if (request === "test" && testTarget !== null) {
    target = testTarget === "/" ? resumable.getOpt("target") : testTarget;
  }

  if (typeof target === "function") {
    return target(params);
  }

  const url = new URL(target as string, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  return url.toString();
}
