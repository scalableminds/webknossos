import { downloadAnnotation } from "admin/rest_api";
import { Button, Col, Divider, Flex, Radio, Row, Tooltip, Typography } from "antd";
import Space from "antd/lib/space";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { useState } from "react";
import { hasVolumeTracings } from "viewer/model/accessors/volumetracing_accessor";
import { Model } from "viewer/singletons";
import { Hint } from "./download_shared";

export function DownloadAnnotationTab({ onClose }: { onClose: () => void }) {
  const annotation = useWkSelector((state) => state.annotation);

  const hasSkeleton = annotation.skeleton != null;
  const hasVolumes = hasVolumeTracings(annotation);
  const hasVolumeFallback = annotation.volumes.some((volume) => volume.fallbackLayer != null);
  const isVolumeNDimensional = annotation.volumes.some(
    (tracing) => tracing.additionalAxes.length > 0,
  );
  const initialFileFormatToDownload = hasVolumes ? "zarr3" : "nml";
  const [fileFormatToDownload, setFileFormatToDownload] = useState<"zarr3" | "wkw" | "nml">(
    initialFileFormatToDownload,
  );

  const handleDownload = async function () {
    await Model.ensureSavedState();
    const includeVolumeData = fileFormatToDownload === "wkw" || fileFormatToDownload === "zarr3";
    downloadAnnotation(
      annotation.annotationId,
      annotation.annotationType,
      hasVolumeFallback,
      undefined,
      fileFormatToDownload,
      includeVolumeData,
    );
    onClose();
  };

  const maybeShowWarning = () => {
    const volumeFallbackWarning = hasVolumeFallback ? (
      <Row key="no-fallback">
        <Typography.Text
          style={{
            margin: "0 6px 12px",
          }}
          type="warning"
        >
          {messages["annotation.no_fallback_data_included"]}
        </Typography.Text>
      </Row>
    ) : null;

    return volumeFallbackWarning;
  };

  const options = [
    ...(hasVolumes
      ? [
          {
            value: "zarr3" as const,
            label: (
              <Space orientation="vertical" size={2}>
                <Typography.Text>Include volume annotations as Zarr</Typography.Text>
                <Hint>Download a zip folder containing Zarr files.</Hint>
              </Space>
            ),
          },
          {
            value: "wkw" as const,
            disabled: isVolumeNDimensional,
            label: (
              <Tooltip
                title={
                  isVolumeNDimensional ? "WKW is not supported for n-dimensional volumes." : null
                }
              >
                <Space orientation="vertical" size={2}>
                  Include volume annotations as WKW
                  <Hint>Download a zip folder containing WKW files.</Hint>
                </Space>
              </Tooltip>
            ),
          },
        ]
      : []),
    {
      value: "nml" as const,
      label: `${hasSkeleton ? "Skeleton annotations" : "Meta data"}${hasVolumes ? " only" : ""} as NML`,
    },
  ];

  return (
    <>
      <Row>
        {maybeShowWarning()}
        <Typography.Paragraph>
          {!hasVolumes ? "This is a Skeleton-only annotation. " : ""}
          {!hasSkeleton ? "This is a Volume-only annotation. " : ""}
          {messages["annotation.download"]}
        </Typography.Paragraph>
      </Row>
      <Divider>Options</Divider>
      <Row>
        <Col span={9}>
          <Space orientation="vertical">
            Select the data you would like to download.
            <Hint>An NML file will always be included with any download.</Hint>
          </Space>
        </Col>
        <Col span={15}>
          <Radio.Group
            defaultValue={initialFileFormatToDownload}
            value={fileFormatToDownload}
            onChange={(e) => setFileFormatToDownload(e.target.value)}
            style={{ marginLeft: 16 }}
            vertical
            options={options}
          />
        </Col>
      </Row>
      <Divider />
      <Flex justify="end" gap="small">
        <Button
          href="https://docs.webknossos.org/webknossos/data/export_ui.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn More
        </Button>
        <Button type="primary" onClick={handleDownload}>
          Download
        </Button>
      </Flex>
    </>
  );
}
