import { FolderOutlined } from "@ant-design/icons";
import { Alert, Card, Col, Form, Row, Select, Space, Statistic } from "antd";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useWkSelector } from "libs/react_hooks";
import { computeVolumeFromBoundingBox } from "libs/utils";
import { useMemo } from "react";
import type { APIAnnotation, APIDataLayer, APIDataset } from "types/api_types";
import {
  getColorLayers,
  getMagInfo,
  getSegmentationLayers,
} from "viewer/model/accessors/dataset_accessor";
import { getSegmentationLayerByHumanReadableName } from "viewer/model/accessors/volumetracing_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { colorLayerMustNotBeUint24Rule } from "../utils";
import {
  type AiTrainingAnnotationSelection,
  useAiTrainingJobContext,
} from "./ai_training_job_context";

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
}: {
  selectedAnnotation: AiTrainingAnnotationSelection;
}) => {
  const dataset = useWkSelector((state) => state.dataset);
  const { handleSelectionChange } = useAiTrainingJobContext();

  const { annotation, imageDataLayer, groundTruthLayer, magnification, userBoundingBoxes } =
    selectedAnnotation;
  const annotationId = annotation.annotationId;

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
    if (imageDataLayer && groundTruthLayer) {
      return getIntersectingMagList(annotation, dataset, groundTruthLayer, imageDataLayer) || [];
    }
    return [];
  }, [imageDataLayer, groundTruthLayer, annotation, dataset]);

  const boundingBoxCount = useMemo(() => userBoundingBoxes.length, [userBoundingBoxes]);
  const boundingBoxVolume = useMemo(
    () =>
      userBoundingBoxes.reduce(
        (sum, box) => sum + computeVolumeFromBoundingBox(box.boundingBox),
        0,
      ),
    [userBoundingBoxes],
  );

  const layerValidationError = useMemo(() => {
    if (imageDataLayer && groundTruthLayer && imageDataLayer === groundTruthLayer) {
      return "Image Data and Ground Truth layers must be different.";
    }
    return undefined;
  }, [imageDataLayer, groundTruthLayer]);

  const magnificationValidationError = useMemo(() => {
    if (imageDataLayer && groundTruthLayer && availableMagnifications.length === 0) {
      return "No common magnification found for the selected layers.";
    }
    return undefined;
  }, [imageDataLayer, groundTruthLayer, availableMagnifications]);

  const { bboxErrors, bboxWarnings } = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (userBoundingBoxes.length === 0) {
      errors.push("At least one bounding box is required for training.");
      return { bboxErrors: errors, bboxWarnings: warnings };
    }

    if (boundingBoxVolume === 0) {
      errors.push("Total volume of bounding boxes cannot be zero.");
    }

    const MIN_BBOX_EXTENT_IN_EACH_DIM = 32;
    const tooSmallBoxes: string[] = [];
    const notMagAlignedBoundingBoxes: string[] = [];

    userBoundingBoxes.forEach((box) => {
      const boundingBox = new BoundingBox(box.boundingBox);
      let effectiveBbox = boundingBox;
      if (magnification) {
        const alignedBoundingBox = boundingBox.alignFromMag1ToMag(magnification, "shrink");
        if (!alignedBoundingBox.equals(boundingBox)) {
          notMagAlignedBoundingBoxes.push(box.name);
        }
        effectiveBbox = alignedBoundingBox;
      }

      const [width, height, depth] = effectiveBbox.getSize();
      if (
        width < MIN_BBOX_EXTENT_IN_EACH_DIM ||
        height < MIN_BBOX_EXTENT_IN_EACH_DIM ||
        depth < MIN_BBOX_EXTENT_IN_EACH_DIM
      ) {
        tooSmallBoxes.push(box.name);
      }
    });

    if (tooSmallBoxes.length > 0) {
      warnings.push(
        `The following bounding boxes are too small. They should be at least ${MIN_BBOX_EXTENT_IN_EACH_DIM} Vx in each dimension: ${tooSmallBoxes.join(
          ", ",
        )}`,
      );
    }

    if (notMagAlignedBoundingBoxes.length > 0) {
      warnings.push(
        `The following bounding boxes are not aligned with the selected magnification and will be automatically shrunk: ${notMagAlignedBoundingBoxes.join(
          ", ",
        )}`,
      );
    }

    return { bboxErrors: errors, bboxWarnings: warnings };
  }, [userBoundingBoxes, magnification, boundingBoxVolume]);

  return (
    <Card style={{ marginBottom: "24px" }} type="inner">
      <Row gutter={24}>
        <Col span={12}>
          <Form.Item
            label="Image Data Layer"
            required
            rules={[
              { required: true, message: "Please select a source for the image data." },
              colorLayerMustNotBeUint24Rule,
            ]}
          >
            <Select
              options={colorLayers.map((l) => ({ value: l.name, label: l.name }))}
              value={imageDataLayer}
              onChange={(value) => handleSelectionChange(annotationId, { imageDataLayer: value })}
            />
          </Form.Item>
          <Form.Item
            label="Ground Truth Layer"
            required
            rules={[
              {
                required: true,
                message: "Please select a source for the ground truth segmentation",
              },
            ]}
            validateStatus={layerValidationError ? "error" : undefined}
            help={layerValidationError}
          >
            <Select
              options={segmentationAndColorLayers.map((l) => ({ value: l, label: l }))}
              value={groundTruthLayer}
              onChange={(value) => handleSelectionChange(annotationId, { groundTruthLayer: value })}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            label="Magnification"
            required
            rules={[{ required: true, message: "Please select a magnification" }]}
            validateStatus={magnificationValidationError ? "error" : undefined}
            help={magnificationValidationError}
          >
            <Select
              disabled={!imageDataLayer || !groundTruthLayer}
              options={availableMagnifications.map((m, index) => ({
                value: index,
                label: `${m[0]}-${m[1]}-${m[2]}`,
              }))}
              value={magnification}
              onChange={(index: number) =>
                handleSelectionChange(annotationId, {
                  magnification: availableMagnifications[index],
                })
              }
            />
          </Form.Item>
          <Space size={"middle"}>
            <Statistic title="Bounding Boxes" value={boundingBoxCount} />
            <Statistic title="Volume" value={formatVoxels(boundingBoxVolume)} />
          </Space>
        </Col>
      </Row>
      {bboxErrors.map((error) => (
        <Alert key={error} message={error} type="error" showIcon style={{ marginTop: 12 }} />
      ))}
      {bboxWarnings.map((warning) => (
        <Alert key={warning} message={warning} type="warning" showIcon style={{ marginTop: 12 }} />
      ))}
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
