import { FolderOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Col, Form, Popover, Row, Select, Space, Statistic } from "antd";
import { formatHash, formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { computeVolumeFromBoundingBox } from "libs/utils";
import groupBy from "lodash/groupBy";
import { useMemo, useState } from "react";
import { ColorWKBlue } from "theme";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { colorLayerMustNotBeUint24Rule, getIntersectingMagList } from "../utils";
import {
  type AiTrainingAnnotationSelection,
  useAiTrainingJobContext,
} from "./ai_training_job_context";
import { AnnotationsCsvInput } from "./annotations_csv_input";

const MIN_BBOX_EXTENT_IN_EACH_DIM = 32;

const AiTrainingDataSelector = ({
  selectedAnnotation,
}: {
  selectedAnnotation: AiTrainingAnnotationSelection;
}) => {
  const { handleSelectionChange } = useAiTrainingJobContext();

  const {
    annotation,
    imageDataLayer,
    groundTruthLayer,
    magnification,
    userBoundingBoxes,
    dataset,
  } = selectedAnnotation;
  const annotationId = annotation.id;

  // Gather layer names from the annotation
  const annotationLayerNames = annotation.annotationLayers
    .filter((layer) => layer.typ === "Volume")
    .map((layer) => layer.name);

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
    <Card
      style={{ marginBottom: "24px" }}
      type="inner"
      title={
        <a
          href={`/annotations/${annotation.id}`}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: "16px" }}
        >
          Annotation: {annotation.name || formatHash(annotation.id)}
        </a>
      }
    >
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
              options={annotationLayerNames.map((l) => ({ value: l, label: l }))}
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
              value={
                magnification
                  ? availableMagnifications.findIndex((m) => V3.equals(m, magnification))
                  : undefined
              }
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
  const [popoverVisible, setPopoverVisible] = useState(false);

  const { warningDetails } = useMemo(() => {
    if (selectedAnnotations.length === 0) {
      return { warningDetails: null };
    }

    const allUserBBoxes = selectedAnnotations.flatMap((a) =>
      a.userBoundingBoxes.map((b) => ({
        ...b,
        magnification: a.magnification,
        annotationId: a.annotation.id,
      })),
    );

    if (allUserBBoxes.length < 2) {
      return { warningDetails: null };
    }

    const minDimensions = allUserBBoxes.reduce(
      (min, { boundingBox: box, magnification }) => {
        let bbox = new BoundingBox(box);
        if (magnification) {
          bbox = bbox.alignFromMag1ToMag(magnification, "shrink");
        }
        const size = bbox.getSize();
        return {
          x: Math.min(min.x, size[0]),
          y: Math.min(min.y, size[1]),
          z: Math.min(min.z, size[2]),
        };
      },
      { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY },
    );

    const nonMultipleBoxes: { name: string; annotationId: string }[] = [];
    allUserBBoxes.forEach(({ boundingBox: box, name, magnification, annotationId }) => {
      let bbox = new BoundingBox(box);
      if (magnification) {
        bbox = bbox.alignFromMag1ToMag(magnification, "shrink");
      }
      const [width, height, depth] = bbox.getSize();

      if (
        (minDimensions.x > 0 && width % minDimensions.x !== 0) ||
        (minDimensions.y > 0 && height % minDimensions.y !== 0) ||
        (minDimensions.z > 0 && depth % minDimensions.z !== 0)
      ) {
        nonMultipleBoxes.push({ name, annotationId });
      }
    });

    if (nonMultipleBoxes.length > 0) {
      return {
        warningDetails: {
          minDimensions,
          nonMultipleBoxes,
        },
      };
    }

    return { warningDetails: null };
  }, [selectedAnnotations]);

  let warningNode = null;
  if (warningDetails) {
    const { minDimensions, nonMultipleBoxes } = warningDetails;
    const groupedBoxes = groupBy(nonMultipleBoxes, "annotationId");
    warningNode = (
      <div style={{ whiteSpace: "pre-wrap" }}>
        {`For optimal training, all bounding boxes should have dimensions that are integer multiples of the smallest box dimensions (${minDimensions.x}x${minDimensions.y}x${minDimensions.z} vx). The following boxes don't meet this requirement:`}
        {Object.entries(groupedBoxes).map(([annotationId, boxes]) => (
          <div key={annotationId} style={{ marginTop: "8px" }}>
            In annotation{" "}
            <a href={`/annotations/${annotationId}`} target="_blank" rel="noopener noreferrer">
              {annotationId}
            </a>
            :
            <ul style={{ margin: "4px 0 0 20px", padding: 0, listStyleType: "disc" }}>
              {boxes.map((box, index) => (
                <li key={index}>{`'${box.name}'`}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <FolderOutlined style={{ color: ColorWKBlue }} />
          Training Data
        </Space>
      }
      extra={
        <Popover
          content={<AnnotationsCsvInput onClose={() => setPopoverVisible(false)} />}
          title="Add additional training data from other annotations by ID or URL"
          trigger="click"
          open={popoverVisible}
          onOpenChange={setPopoverVisible}
        >
          <Button icon={<PlusOutlined />} shape="circle" />
        </Popover>
      }
    >
      <Form layout="vertical">
        {selectedAnnotations.map((selectedAnnotation) => {
          return (
            <AiTrainingDataSelector
              key={selectedAnnotation.annotation.id}
              selectedAnnotation={selectedAnnotation}
            />
          );
        })}
        {warningNode && (
          <Alert message={warningNode} type="warning" showIcon style={{ marginTop: 12 }} />
        )}
      </Form>
    </Card>
  );
};
