import { downloadAnnotation } from "admin/rest_api";
import { Button, Col, Divider, Flex, Radio, Row, Tooltip, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import { useState } from "react";
import { hasVolumeTracings } from "viewer/model/accessors/volumetracing_accessor";
import { Model } from "viewer/singletons";
import { Hint, MoreInfoHint } from "./download_info_shared";

const radioButtonStyle = {
  marginBottom: 24,
};

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

  return (
    <>
      <Row>
        {maybeShowWarning()}
        <Typography.Text
          style={{
            margin: "0 6px 12px",
          }}
        >
          {!hasVolumes ? "This is a Skeleton-only annotation. " : ""}
          {!hasSkeleton ? "This is a Volume-only annotation. " : ""}
          {messages["annotation.download"]}
        </Typography.Text>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      >
        Options
      </Divider>
      <Row>
        <Col
          span={9}
          style={{
            lineHeight: "20px",
            padding: "5px 12px",
          }}
        >
          Select the data you would like to download.
          <Hint style={{ marginTop: 12 }}>
            An NML file will always be included with any download.
          </Hint>
        </Col>
        <Col span={15}>
          <Radio.Group
            defaultValue={initialFileFormatToDownload}
            value={fileFormatToDownload}
            onChange={(e) => setFileFormatToDownload(e.target.value)}
            style={{ marginLeft: 16 }}
          >
            {hasVolumes ? (
              <>
                <Radio value="zarr3" style={radioButtonStyle}>
                  Include volume annotations as Zarr
                  <Hint style={{}}>Download a zip folder containing Zarr files.</Hint>
                </Radio>
                <Tooltip
                  title={
                    isVolumeNDimensional ? "WKW is not supported for n-dimensional volumes." : null
                  }
                >
                  <Radio value="wkw" disabled={isVolumeNDimensional} style={radioButtonStyle}>
                    Include volume annotations as WKW
                    <Hint style={{}}>Download a zip folder containing WKW files.</Hint>
                  </Radio>
                </Tooltip>
              </>
            ) : null}
            <Radio value="nml" style={radioButtonStyle}>
              {hasSkeleton ? "Skeleton annotations" : "Meta data"} {hasVolumes ? "only " : ""}
              as NML
            </Radio>
          </Radio.Group>
        </Col>
      </Row>
      <Divider
        style={{
          margin: "18px 0",
        }}
      />
      <MoreInfoHint />
      <Flex justify="end">
        <Button type="primary" onClick={handleDownload}>
          Download
        </Button>
      </Flex>
    </>
  );
}
