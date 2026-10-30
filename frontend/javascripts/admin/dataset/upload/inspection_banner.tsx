import { LoadingOutlined } from "@ant-design/icons";
import { Alert, type AlertProps, Flex, Tag } from "antd";
import { pluralize } from "libs/utils";
import messages from "messages";
import type React from "react";
import type { DetectedDatasetFormat } from "./detect_dataset_format";
import type { FileInspection } from "./use_file_inspection";

// Every file is sent with its own requests, so many small files upload much slower than a zip
// archive of the same data.
const MANY_FILES_THRESHOLD = 100;

const CONVERSION_NOTE =
  "We'll convert it automatically after the upload — this usually takes a few minutes.";

function describeFormat(format: DetectedDatasetFormat): React.ReactNode {
  switch (format.kind) {
    case "native":
      return <strong>Recognized as {format.formatName}</strong>;
    case "imageStack":
      return (
        <>
          <strong>
            Recognized as {format.formatName === "image" ? "an" : `a ${format.formatName}`} image
            stack
          </strong>{" "}
          ({format.sliceCount.toLocaleString()} {pluralize("slice", format.sliceCount)},{" "}
          {format.layerCount} {pluralize("layer", format.layerCount)})
        </>
      );
    case "imageFiles":
      return (
        <strong>
          Recognized as {format.fileCount}{" "}
          {format.formatName === "image" ? "" : `${format.formatName} `}
          {pluralize("file", format.fileCount)}
        </strong>
      );
    case "unknown":
      return <strong>Format not recognized</strong>;
  }
}

function ConversionUnavailableNote() {
  return (
    <>
      This WEBKNOSSOS instance can&apos;t convert it. Please convert the data to Zarr or WKW using
      the{" "}
      <a target="_blank" href="https://docs.webknossos.org/cli" rel="noopener noreferrer">
        WEBKNOSSOS CLI
      </a>{" "}
      or the{" "}
      <a target="_blank" href="https://docs.webknossos.org/webknossos-py" rel="noopener noreferrer">
        Python library
      </a>
      , or use{" "}
      <a target="_blank" href="https://webknossos.org" rel="noopener noreferrer">
        webknossos.org
      </a>
      , which converts it automatically.
    </>
  );
}

function getBannerProps(
  inspection: FileInspection,
  isDatasetConversionEnabled: boolean,
): AlertProps | null {
  switch (inspection.status) {
    case "empty":
      return null;
    case "inspecting":
      return { type: "info", icon: <LoadingOutlined />, title: "Inspecting the selected files …" };
    case "invalidArchive":
      return { type: "error", title: messages["dataset.upload_invalid_zip"] };
    case "failed":
      return {
        type: "error",
        title: "The selected files could not be inspected. Please reload the page and try again.",
      };
  }

  const { format } = inspection;
  if (inspection.containsAnnotation) {
    return { type: "error", title: messages["dataset.upload_zip_with_nml"] };
  }
  if (format.kind === "native") {
    return {
      type: "success",
      title: <>{describeFormat(format)} — ready to view, no conversion needed.</>,
      description:
        format.layerNames.length > 0 ? (
          <Flex wrap gap={6}>
            {format.layerNames.map((layerName) => (
              <Tag key={layerName} variant="outlined" style={{ marginInlineEnd: 0 }}>
                {layerName}
              </Tag>
            ))}
          </Flex>
        ) : undefined,
    };
  }
  if (!isDatasetConversionEnabled) {
    return {
      type: "error",
      title: (
        <>
          {describeFormat(format)}. <ConversionUnavailableNote />
        </>
      ),
    };
  }
  if (format.kind === "unknown") {
    return {
      type: "warning",
      title: (
        <>{describeFormat(format)}. We&apos;ll try to convert it automatically after the upload.</>
      ),
    };
  }
  return {
    type: "info",
    title: (
      <>
        {describeFormat(format)}. {CONVERSION_NOTE}
      </>
    ),
  };
}

export function isInspectionBlockingUpload(
  inspection: FileInspection,
  isDatasetConversionEnabled: boolean,
): boolean {
  if (inspection.status !== "done") return true;
  return (
    inspection.containsAnnotation ||
    (inspection.format.kind !== "native" && !isDatasetConversionEnabled)
  );
}

export function InspectionBanner({
  inspection,
  isDatasetConversionEnabled,
}: {
  inspection: FileInspection;
  isDatasetConversionEnabled: boolean;
}) {
  const bannerProps = getBannerProps(inspection, isDatasetConversionEnabled);
  if (bannerProps == null) return null;
  return <Alert showIcon className="dataset-upload-inspection-banner" {...bannerProps} />;
}

export function ManyFilesHint({ fileCount }: { fileCount: number }) {
  if (fileCount <= MANY_FILES_THRESHOLD) return null;
  return (
    <Alert
      showIcon
      type="info"
      className="dataset-upload-inspection-banner"
      title={`Uploading ${fileCount.toLocaleString()} individual files is slow. Zipping them into a single archive makes the upload much faster.`}
    />
  );
}
