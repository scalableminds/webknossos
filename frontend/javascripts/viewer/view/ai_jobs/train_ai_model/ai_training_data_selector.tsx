import React, { useState, useEffect } from "react";
import { Table, Select, Space, Button, Alert, Tag, Card, Form, Row, Col, Input } from "antd";
import { FolderOutlined, SettingOutlined } from "@ant-design/icons";
import { AnnotationInfoForAITrainingJob } from "viewer/view/action-bar/ai_job_modals/utils";
import { useWatch } from "antd/es/form/Form";
import {
  getColorLayers,
  getMagInfo,
  getSegmentationLayers,
} from "viewer/model/accessors/dataset_accessor";
import { getSegmentationLayerByHumanReadableName } from "viewer/model/accessors/volumetracing_accessor";
import { useAiTrainingJobContext } from "./ai_training_job_context";

const { Option } = Select;

const AiTrainingDataSelector = (props: AnnotationInfoForAITrainingJob) => {
  const { annotation, dataset, volumeTracings, volumeTracingMags } = props;
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
  const fixedSelectedSegmentationLayer =
    segmentationAndColorLayers.length === 1 ? segmentationAndColorLayers[0] : null;

  // Remove uint24 color layers because they cannot be trained on currently
  const colorLayers = getColorLayers(dataset).filter((layer) => layer.elementClass !== "uint24");
  const fixedSelectedColorLayer = colorLayers.length === 1 ? colorLayers[0] : null;
  const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;
  const imageDataLayer = Form.useWatch("imageDataLayer");

  return (
    <Card style={{ marginBottom: "24px" }}>
      <Row gutter={24}>
        <Col span={12}>
          <Form.Item
            name="imageDataLayer"
            label="Image Data Layer"
            rules={[{ required: true, message: "Please select an image data layer" }]}
          >
            <Select options={colorLayers.map((l) => ({ value: l.name, label: l.name }))} />
          </Form.Item>
          <Form.Item
            name="groundTruthLayer"
            label="Ground Truth Layer"
            rules={[{ required: true, message: "Please select a ground truth layer" }]}
          >
            <Select options={segmentationLayers.map((l) => ({ value: l.name, label: l.name }))} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item
            name="magnification"
            label="Magnification"
            rules={[{ required: true, message: "Please select a magnification" }]}
          >
            <Select
              disabled={!imageDataLayer}
              options={availableMagnifications.map((m) => ({
                value: m,
                label: `${m[0]}x, ${m[1]}x, ${m[2]}x`,
              }))}
            />
          </Form.Item>
        </Col>
      </Row>
    </Card>
  );
};

export const AiTrainingDataSection = () => {
  const { annotationInfos } = useAiTrainingJobContext();

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
        <AiTrainingDataSelector />
        <AiTrainingDataSelector />
      </Form>
    </Card>
  );
};
