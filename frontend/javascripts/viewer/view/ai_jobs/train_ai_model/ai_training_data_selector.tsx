import {
  AppstoreAddOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  ExclamationCircleFilled,
  PlusOutlined,
} from "@ant-design/icons";
import { Alert, Button, Flex, Form, Popover, Select, Typography, theme } from "antd";
import { formatVoxels } from "libs/format_utils";
import { V3 } from "libs/mjs";
import groupBy from "lodash-es/groupBy";
import { useMemo, useState } from "react";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import BoundingBox from "viewer/model/bucket_data_handling/bounding_box";
import { useGenerateBBModalContext } from "viewer/view/ai_jobs/generate_BB_modal_context";
import { JobSection } from "../components/job_section";
import { colorLayerMustNotBeUint24Rule } from "../utils";
import {
  type AiTrainingAnnotationSelection,
  useAiTrainingJobContext,
} from "./ai_training_job_context";
import { AnnotationsCsvInput } from "./annotations_csv_input";
import {
  getAnnotationDisplayName,
  getTrainingAnnotationIssues,
  getTrainingVolume,
  hasTrainingAnnotationErrors,
} from "./training_data_validation";

const { Text } = Typography;

function AnnotationStatusIcon({
  hasErrors,
  hasWarnings,
  isComplete,
}: {
  hasErrors: boolean;
  hasWarnings: boolean;
  isComplete: boolean;
}) {
  const { cssVar } = theme.useToken();
  if (hasErrors) return <CloseCircleFilled style={{ color: cssVar.colorError }} />;
  if (hasWarnings) return <ExclamationCircleFilled style={{ color: cssVar.colorWarning }} />;
  if (isComplete) return <CheckCircleFilled style={{ color: cssVar.colorSuccess }} />;
  return null;
}

const AiTrainingDataSelector = ({
  selectedAnnotation,
}: {
  selectedAnnotation: AiTrainingAnnotationSelection;
}) => {
  const { cssVar } = theme.useToken();
  const { openGenerateBBModal } = useGenerateBBModalContext();
  const { handleSelectionChange, setSelectedAnnotations, selectedJobType } =
    useAiTrainingJobContext();

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

  const issues = useMemo(
    () => getTrainingAnnotationIssues(selectedAnnotation),
    [selectedAnnotation],
  );
  const { availableMagnifications, layerError, magnificationError, bboxErrors, bboxWarnings } =
    issues;
  const hasErrors = hasTrainingAnnotationErrors(issues);
  // The most severe issue is summarized in the header. Everything that needs more words than
  // its summary is spelled out below the layer selection.
  const headerIssue = bboxErrors[0] ?? bboxWarnings[0];
  const summary = headerIssue?.summary;
  const detailedIssues = [
    ...bboxErrors.map((issue) => ({ issue, type: "error" as const })),
    ...bboxWarnings.map((issue) => ({ issue, type: "warning" as const })),
  ].filter(({ issue }) => issue !== headerIssue || issue.details);
  const isComplete = Boolean(imageDataLayer && groundTruthLayer && magnification);

  return (
    <div
      style={{
        border: `1px solid ${hasErrors ? cssVar.colorErrorBorder : cssVar.colorBorderSecondary}`,
        borderRadius: cssVar.borderRadiusLG,
        overflow: "hidden",
      }}
    >
      <Flex
        align="center"
        gap="small"
        style={{
          padding: "12px 16px",
          background: hasErrors ? cssVar.colorErrorBg : undefined,
        }}
      >
        <AnnotationStatusIcon
          hasErrors={hasErrors}
          hasWarnings={bboxWarnings.length > 0}
          isComplete={isComplete}
        />
        <Typography.Link
          href={`/annotations/${annotation.id}`}
          target="_blank"
          rel="noreferrer"
          strong
        >
          Annotation {getAnnotationDisplayName(annotation)}
        </Typography.Link>
        <Text
          ellipsis={{ tooltip: summary }}
          style={{ flex: 1, minWidth: 0, color: cssVar.colorTextSecondary }}
        >
          {summary}
        </Text>
        {summary && (
          <Button
            size="small"
            icon={<AppstoreAddOutlined />}
            onClick={() => openGenerateBBModal(magnification ?? null, selectedJobType)}
          >
            Generate
          </Button>
        )}
        <Button
          type="text"
          icon={<DeleteOutlined />}
          aria-label="Remove annotation"
          onClick={() =>
            setSelectedAnnotations((prev) => prev.filter((a) => a.annotation.id !== annotationId))
          }
        />
      </Flex>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, padding: 16 }}>
        <Form.Item
          label="Image data layer"
          required
          style={{ marginBottom: 0 }}
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
          label="Ground truth layer"
          required
          style={{ marginBottom: 0 }}
          rules={[
            {
              required: true,
              message: "Please select a source for the ground truth segmentation",
            },
          ]}
          validateStatus={layerError ? "error" : undefined}
          help={layerError}
        >
          <Select
            options={annotationLayerNames.map((l) => ({ value: l, label: l }))}
            value={groundTruthLayer}
            onChange={(value) => handleSelectionChange(annotationId, { groundTruthLayer: value })}
          />
        </Form.Item>
        <Form.Item
          label="Magnification"
          required
          style={{ marginBottom: 0 }}
          rules={[{ required: true, message: "Please select a magnification" }]}
          validateStatus={magnificationError ? "error" : undefined}
          help={magnificationError}
        >
          <Select
            disabled={!imageDataLayer || !groundTruthLayer}
            placeholder="Select"
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
      </div>
      <Flex gap="large" style={{ padding: "0 16px 16px" }}>
        <Text type="secondary">
          Bounding boxes <Text strong>{userBoundingBoxes.length}</Text>
        </Text>
        <Text type="secondary">
          Volume <Text strong>{formatVoxels(getTrainingVolume(selectedAnnotation))}</Text>
        </Text>
      </Flex>
      {detailedIssues.length > 0 && (
        <Flex vertical gap="small" style={{ padding: "0 16px 16px" }}>
          {detailedIssues.map(({ issue, type }) => (
            <Alert
              key={issue.summary}
              title={issue.details ?? issue.summary}
              type={type}
              showIcon
            />
          ))}
        </Flex>
      )}
    </div>
  );
};

export const AiTrainingDataSection = () => {
  const { selectedAnnotations, stepStatuses } = useAiTrainingJobContext();
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
    <JobSection
      step={2}
      title="Training data"
      description="Each annotation needs a ground-truth layer and bounding boxes."
      status={stepStatuses.trainingData}
      extra={
        <Popover
          content={<AnnotationsCsvInput onClose={() => setPopoverVisible(false)} />}
          title="Add additional training data from other annotations by ID or URL"
          trigger="click"
          open={popoverVisible}
          onOpenChange={setPopoverVisible}
        >
          <Button icon={<PlusOutlined />}>Add annotation</Button>
        </Popover>
      }
    >
      <Form layout="vertical">
        <Flex vertical gap="middle">
          {selectedAnnotations.length === 0 && (
            <Text type="secondary" style={{ textAlign: "center", padding: 24 }}>
              Please add training annotations via the "Add annotation" button.
            </Text>
          )}
          {selectedAnnotations.map((selectedAnnotation) => (
            <AiTrainingDataSelector
              key={selectedAnnotation.annotation.id}
              selectedAnnotation={selectedAnnotation}
            />
          ))}
          {warningNode && <Alert title={warningNode} type="warning" showIcon />}
        </Flex>
      </Form>
    </JobSection>
  );
};
