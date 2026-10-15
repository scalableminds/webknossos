import { sendAnalyticsEvent } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import importDynamic from "libs/import_dynamic";
import { getFileExtension } from "libs/utils";
import countBy from "lodash-es/countBy";
import { useEffect, useState } from "react";
import type { FileWithPath } from "react-dropzone";
import {
  containsAnnotationFile,
  type DetectedDatasetFormat,
  detectDatasetFormat,
  isArchive,
} from "./detect_dataset_format";

export type FileInspection =
  | { status: "empty" }
  | { status: "inspecting" }
  | { status: "invalidArchive" }
  | { status: "done"; format: DetectedDatasetFormat; containsAnnotation: boolean };

async function listArchiveEntries(file: File): Promise<string[] | null> {
  // @zip.js is a fairly large module
  // Dynamically import it to avoid loading it on Dashboard/admin pages.
  const zipJs = await importDynamic(() => import("@zip.js/zip.js")).catch(() => null);
  if (zipJs == null) {
    // The user was already notified about the failed import by importDynamic.
    return null;
  }
  try {
    const reader = new zipJs.ZipReader(new zipJs.BlobReader(file));
    const entries = await reader.getEntries();
    await reader.close();
    return entries.map((entry) => entry.filename);
  } catch (error) {
    console.error(error);
    ErrorHandling.notify(error as Error);
    return null;
  }
}

async function inspectFiles(files: FileWithPath[]): Promise<FileInspection> {
  let paths = files.map((file) => file.path || file.name);
  // At most one archive is allowed, which is enforced by the form validation.
  const archive = files.find((file) => isArchive(file.name));
  if (archive != null) {
    const entries = await listArchiveEntries(archive as File);
    if (entries == null) return { status: "invalidArchive" };
    paths = entries;
  }

  sendAnalyticsEvent("add_files_to_upload", {
    fileExtensions: countBy(
      files.map((file) => file.name).concat(archive != null ? paths : []),
      getFileExtension,
    ),
  });

  return {
    status: "done",
    format: detectDatasetFormat(paths),
    containsAnnotation: containsAnnotationFile(paths),
  };
}

/** Infers the dataset format of the selected files, looking into zip archives if necessary. */
export function useFileInspection(files: FileWithPath[]): FileInspection {
  const [inspection, setInspection] = useState<FileInspection>({ status: "empty" });

  useEffect(() => {
    if (files.length === 0) {
      setInspection({ status: "empty" });
      return;
    }
    let isCancelled = false;
    setInspection({ status: "inspecting" });
    inspectFiles(files).then((result) => {
      if (!isCancelled) setInspection(result);
    });
    return () => {
      isCancelled = true;
    };
  }, [files]);

  return inspection;
}

export function needsConversion(inspection: FileInspection): boolean {
  return inspection.status === "done" && inspection.format.kind !== "native";
}
