import React, { useState, useEffect } from "react";
import { Table, Select, Space, Button, Alert, Tag, Card, Form, Row, Col, Input } from "antd";
import { FolderOutlined, SettingOutlined } from "@ant-design/icons";

const { Option } = Select;

const getMagsForSegmentationLayer = (annotation: string, layerName: string) => {
      const segmentationLayer = getSegmentationLayerByHumanReadableName(
        dataset,
        annotation,
        layerName,
      );
      return getMagInfo(segmentationLayer.resolutions);
    }
  );
  const userBoundingBoxes = getSomeTracing(annotation).userBoundingBoxes;

const AiTrainingDataSelector = () => {
  const colorLayers = [];
  const segmentationLayers = [];
  const availableMagnifications = [];
  const imageDataLayer = false;

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
