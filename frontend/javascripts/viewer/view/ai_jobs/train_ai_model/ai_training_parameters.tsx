import { SettingOutlined } from "@ant-design/icons";
import { Card, Col, Form, Input, InputNumber, Row, Select, Space } from "antd";
import type { FormProps } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useMemo } from "react";
import { APIJobType } from "types/api_types";
import {
  getColorLayers,
  getMagInfo,
  getSegmentationLayers,
} from "viewer/model/accessors/dataset_accessor";

import { useAiTrainingJobContext } from "./ai_training_job_context";

export const AiTrainingParameters: React.FC = () => {
  const {
    modelName,
    setModelName,
    imageDataLayer,
    setImageDataLayer,
    groundTruthLayer,
    setGroundTruthLayer,
    magnification,
    setMagnification,
    comments,
    setComments,
    selectedTask,
    maxDistanceNm,
    setMaxDistanceNm,
  } = useAiTrainingJobContext();

  const dataset = useWkSelector((state) => state.dataset);
  const colorLayers = getColorLayers(dataset);
  const segmentationLayers = getSegmentationLayers(dataset);

  const availableMagnifications = useMemo(() => {
    if (!imageDataLayer) {
      return [];
    }
    const selectedLayer = colorLayers.find((l) => l.name === imageDataLayer);
    if (!selectedLayer) {
      return [];
    }
    return getMagInfo(selectedLayer.resolutions).getMagList();
  }, [imageDataLayer, colorLayers]);

  const handleValuesChange: FormProps["onValuesChange"] = (changedValues) => {
    if (Object.prototype.hasOwnProperty.call(changedValues, "modelName")) {
      setModelName(changedValues.modelName);
    }
    if (Object.prototype.hasOwnProperty.call(changedValues, "imageDataLayer")) {
      setImageDataLayer(changedValues.imageDataLayer);
      setMagnification(null);
    }
    if (Object.prototype.hasOwnProperty.call(changedValues, "groundTruthLayer")) {
      setGroundTruthLayer(changedValues.groundTruthLayer);
    }
    if (Object.prototype.hasOwnProperty.call(changedValues, "magnification")) {
      setMagnification(changedValues.magnification);
    }
    if (Object.prototype.hasOwnProperty.call(changedValues, "comments")) {
      setComments(changedValues.comments);
    }
    if (Object.prototype.hasOwnProperty.call(changedValues, "maxDistanceNm")) {
      setMaxDistanceNm(changedValues.maxDistanceNm);
    }
  };

  const formFields = [
    { name: ["modelName"], value: modelName },
    { name: ["imageDataLayer"], value: imageDataLayer },
    { name: ["groundTruthLayer"], value: groundTruthLayer },
    { name: ["magnification"], value: magnification },
    { name: ["comments"], value: comments },
    { name: ["maxDistanceNm"], value: maxDistanceNm },
  ];

  return (
    <Card
      title={
        <Space align="center">
          <SettingOutlined style={{ color: "#1890ff" }} />
          Training Parameters
        </Space>
      }
    >
      <Form layout="vertical" onValuesChange={handleValuesChange} fields={formFields}>
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              name="modelName"
              label="Model Name"
              rules={[{ required: true, message: "Please provide a name for the new model" }]}
            >
              <Input />
            </Form.Item>
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
            <Form.Item name="comments" label="Comments">
              <Input.TextArea rows={4} />
            </Form.Item>
            {selectedTask?.jobType === APIJobType.TRAIN_INSTANCE_MODEL && (
              <Form.Item
                name="maxDistanceNm"
                label="Max Distance (nm)"
                rules={[{ required: true, message: "Please enter a positive number" }]}
              >
                <InputNumber min={0.1} suffix="nm" />
              </Form.Item>
            )}
          </Col>
        </Row>
      </Form>
    </Card>
  );
};
