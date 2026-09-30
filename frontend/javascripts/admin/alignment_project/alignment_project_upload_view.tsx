import { InboxOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import { CardContainer, DatastoreFormItem } from "admin/dataset/dataset_components";
import { Alert, Button, Col, Form, Input, Row, Upload, type UploadFile } from "antd";
import { formatBytes } from "libs/format_utils";
import Toast from "libs/toast";
import { Vector3Input } from "libs/vector_input";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { APIDataStore } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { createAlignmentProject } from "./alignment_project_mock_data";

type FormValues = {
  name: string;
  description: string;
  datastoreUrl: string;
  voxelSize: Vector3;
};

export default function AlignmentProjectUploadView({ datastores }: { datastores: APIDataStore[] }) {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const csvFiles = files.filter((file) => file.name.toLowerCase().endsWith(".csv"));
  const totalSizeInBytes = files.reduce((sum, file) => sum + (file.size ?? 0), 0);

  const getFileAlert = () => {
    if (files.length === 0) return null;
    if (csvFiles.length === 0) {
      return { type: "error" as const, title: "No CSV file found among the selected files." };
    }
    if (csvFiles.length > 1) {
      return {
        type: "error" as const,
        title: `Found ${csvFiles.length} CSV files (${csvFiles.map((f) => f.name).join(", ")}). Only one is allowed.`,
      };
    }
    return null;
  };
  const fileAlert = getFileAlert();

  const handleSubmit = async (values: FormValues) => {
    if (csvFiles.length !== 1) {
      Toast.error("Please select the tile images together with exactly one CSV file.");
      return;
    }
    setIsUploading(true);
    try {
      const project = await createAlignmentProject({
        name: values.name,
        description: values.description ?? "",
        dataStoreName:
          datastores.find((datastore) => datastore.url === values.datastoreUrl)?.name ?? "",
        voxelSize: values.voxelSize,
        csvFileName: csvFiles[0].name,
        fileCount: files.length,
        totalSizeInBytes,
      });
      await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
      Toast.success("Alignment project uploaded successfully.");
      navigate(`/alignmentProjects/${project.id}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div style={{ padding: 5 }}>
      <CardContainer
        title="Upload Files for Alignment Project"
        subtitle="Upload unaligned (tiled) image data together with a CSV that lists the tile positions. You can then start one or more alignments from the project page."
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <DatastoreFormItem datastores={datastores} hidden={datastores.length <= 1} />
          <Row gutter={24}>
            <Col span={12}>
              <Form.Item
                name="name"
                label="Project Name"
                rules={[{ required: true, message: "Please provide a name for the project." }]}
              >
                <Input placeholder="e.g. Mouse Cortex L4 – Serial Sections" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="voxelSize"
                label="Voxel Size (nm)"
                tooltip="The extent (x, y, z) of one voxel. Used for the aligned output datasets."
                rules={[{ required: true, message: "Please provide a voxel size." }]}
              >
                <Vector3Input allowDecimals placeholder="e.g. 4, 4, 35" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={3} />
          </Form.Item>

          <Form.Item
            label="Files"
            required
            tooltip="The tile images plus one CSV with one row per tile, e.g. with the columns path, section, x, y. Paths are relative to the uploaded folder."
          >
            <Upload.Dragger
              multiple
              directory
              showUploadList={false}
              fileList={files}
              beforeUpload={() => false}
              onChange={({ fileList }) => setFiles(fileList)}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              {files.length === 0 ? (
                <p className="ant-upload-text">
                  Drop the folder containing the tile images and the tile CSV here or click to
                  select it
                </p>
              ) : (
                <p className="ant-upload-text">
                  {files.length.toLocaleString()} files selected ({formatBytes(totalSizeInBytes, 1)}
                  )
                </p>
              )}
            </Upload.Dragger>
          </Form.Item>

          {fileAlert != null && (
            <Alert
              type={fileAlert.type}
              showIcon
              style={{ marginBottom: 24 }}
              title={fileAlert.title}
            />
          )}

          <Button type="primary" htmlType="submit" size="large" block loading={isUploading}>
            Upload
          </Button>
        </Form>
      </CardContainer>
    </div>
  );
}
