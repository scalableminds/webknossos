import { SettingOutlined } from "@ant-design/icons";
import { Card, Col, Input, Row, Select, Space, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import { BoundingBoxSelector } from "../bounding_box_selector";
import { useRunAiModelJobContext } from "./ai_image_segmentation_job_context";

const { Text, Title } = Typography;

export const AiAnalysisParameters: React.FC = () => {
  const {
    selectedBoundingBox,
    setSelectedBoundingBox,
    newDatasetName,
    setNewDatasetName,
    selectedLayerName,
    setSelectedLayerName,
  } = useRunAiModelJobContext();
  const dataset = useWkSelector((state) => state.dataset);
  const colorLayers = getColorLayers(dataset);

  return (
    <Card
      title={
        <Space align="center">
          <SettingOutlined style={{ color: "#1890ff" }} />
          Analysis Parameters
        </Space>
      }
    >
      <Row gutter={24}>
        <Col span={12}>
          <div style={{ marginBottom: "16px" }}>
            <Text>New Dataset Name</Text>
            <Input value={newDatasetName} onChange={(e) => setNewDatasetName(e.target.value)} />
          </div>
          <div style={{ marginBottom: "16px" }}>
            <Text>Image Data Layer</Text>
            <Select
              style={{ width: "100%" }}
              value={selectedLayerName}
              onChange={setSelectedLayerName}
              options={colorLayers.map((l) => ({ value: l.name, label: l.name }))}
            />
          </div>
        </Col>
        <Col span={12}>
          <div style={{ marginBottom: "16px" }}>
            <Text>Bounding Box</Text>
            <BoundingBoxSelector value={selectedBoundingBox} onChange={setSelectedBoundingBox} />
          </div>
          <div>
            <Text>Comments</Text>
            <Input.TextArea rows={4} />
          </div>
        </Col>
      </Row>
    </Card>
  );
};
