import { FolderOutlined } from "@ant-design/icons";
import { Card, Col, Form, Row, Select, Space, Statistic } from "antd";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { computeVolumeFromBoundingBox } from "libs/utils";
import _ from "lodash";
import { useMemo } from "react";
import type { APIAnnotation, APIDataLayer, APIDataset } from "types/api_types";
import {
  getColorLayers,
  getMagInfo,
  getSegmentationLayers,
} from "viewer/model/accessors/dataset_accessor";
import { getSegmentationLayerByHumanReadableName } from "viewer/model/accessors/volumetracing_accessor";
import {
  type AiTrainingAnnotationSelection,
  useAiTrainingJobContext,
} from "./ai_training_job_context";
import { useWkSelector } from "libs/react_hooks";

const getMagsForColorLayer = (colorLayers: APIDataLayer[], layerName: string) => {
  const colorLayer = colorLayers.find((layer) => layer.name === layerName);
  return colorLayer != null ? getMagInfo(colorLayer.resolutions).getMagList() : null;
};

const getIntersectingMagList = (
  annotation: APIAnnotation,
  dataset: APIDataset,
  groundTruthLayerName: string,
  imageDataLayerName: string,
) => {
  const colorLayers = getColorLayers(dataset);
  const dataLayerMags = getMagsForColorLayer(colorLayers, imageDataLayerName);
  const segmentationLayer = getSegmentationLayerByHumanReadableName(
    dataset,
    annotation,
    groundTruthLayerName,
  );
  const groundTruthLayerMags = getMagInfo(segmentationLayer.resolutions).getMagList();

  return groundTruthLayerMags?.filter((groundTruthMag) =>
    dataLayerMags?.find((mag) => V3.equals(mag, groundTruthMag)),
  );
};

const AiTrainingDataSelector = ({
  selectedAnnotation,
}: { selectedAnnotation: AiTrainingAnnotationSelection }) => {
  const dataset = useWkSelector((state) => state.dataset);
  const { handleSelectionChange } = useAiTrainingJobContext();

  const annotation = selectedAnnotation.annotation;
  const annotationId = selectedAnnotation.annotation.annotationId;

  // Gather layer names from dataset. Omit the layers that are also present
  // in annotationLayers.
  const segmentationLayerNames = getSegmentationLayers(dataset)
    .map((layer) => layer.name)
    .filter(
      (tracingId) =>
        !annotation.annotationLayers.find(
          (annotationLayer) => annotationLayer.tracingId === tracingId,
        ),
    );

  // Gather layer names from the annotation
  const annotationLayerNames = annotation.annotationLayers
    .filter((layer) => layer.typ === "Volume")
    .map((layer) => layer.name);

  const segmentationAndColorLayers: Array<string> = _.uniq([
    ...segmentationLayerNames,
    ...annotationLayerNames,
  ]);

  // Remove uint24 color layers because they cannot be trained on currently
  const colorLayers = getColorLayers(dataset).filter((layer) => layer.elementClass !== "uint24");

  const availableMagnifications = useMemo(() => {
    if (selectedAnnotation?.imageDataLayer && selectedAnnotation?.groundTruthLayer) {
      return (
        getIntersectingMagList(
          annotation,
          dataset,
          selectedAnnotation.groundTruthLayer,
          selectedAnnotation.imageDataLayer,
        ) || []
      );
    }
    return [];
  }, [
    selectedAnnotation?.imageDataLayer,
    selectedAnnotation?.groundTruthLayer,
    annotation,
    dataset,
  ]);

  const boundingBoxCount = useMemo(
    () => selectedAnnotation.userBoundingBoxes.length,
    [selectedAnnotation.userBoundingBoxes],
  );
  const boundingBoxVolume = useMemo(
    () =>
      selectedAnnotation.userBoundingBoxes.reduce(
        (sum, box) => sum + computeVolumeFromBoundingBox(box.boundingBox),
        0,
      ),
    [selectedAnnotation?.userBoundingBoxes],
  );

  return (
    <Card title={`Annotation: ${annotationId}`} style={{ marginBottom: "24px" }}>
      <Row gutter={24}>
        <Col span={12}>
          <Form.Item
            label="Image Data Layer"
            required
            rules={[{ required: true, message: "Please select an image data layer" }]}
          >
            <Select
              options={colorLayers.map((l) => ({ value: l.name, label: l.name }))}
              value={selectedAnnotation?.imageDataLayer}
              onChange={(value) => handleSelectionChange(annotationId, { imageDataLayer: value })}
            />
          </Form.Item>
          <Form.Item
            label="Ground Truth Layer"
            required
            rules={[{ required: true, message: "Please select a ground truth layer" }]}
          >
            <Select
              options={segmentationAndColorLayers.map((l) => ({ value: l, label: l }))}
              value={selectedAnnotation?.groundTruthLayer}
              onChange={(value) => handleSelectionChange(annotationId, { groundTruthLayer: value })}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            label="Magnification"
            required
            rules={[{ required: true, message: "Please select a magnification" }]}
          >
            <Select
              disabled={
                !selectedAnnotation?.imageDataLayer || !selectedAnnotation?.groundTruthLayer
              }
              options={availableMagnifications.map((m, index) => ({
                value: index,
                label: `${m[0]}-${m[1]}-${m[2]}`,
              }))}
              value={selectedAnnotation?.magnification}
              onChange={(index: number) =>
                handleSelectionChange(annotationId, {
                  magnification: availableMagnifications[index],
                })
              }
            />
          </Form.Item>
          <Space size={"middle"}>
            <Statistic title="Bounding\n Boxes" value={boundingBoxCount} />
            <Statistic title="Volume" value={formatVoxels(boundingBoxVolume)} />
          </Space>
        </Col>
      </Row>
    </Card>
  );
};

export const AiTrainingDataSection = () => {
  const { selectedAnnotations } = useAiTrainingJobContext();

  return (
    <Card
      title={
        <Space align="center">
          <FolderOutlined style={{ color: "#1890ff" }} />
          Training Data
        </Space>
      }
    >
      <Form layout="vertical">
        {selectedAnnotations.map((selectedAnnotation) => {
          return (
            <AiTrainingDataSelector
              key={selectedAnnotation.annotation.annotationId}
              selectedAnnotation={selectedAnnotation}
            />
          );
        })}
      </Form>
    </Card>
  );
};
