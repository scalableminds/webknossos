import { ExperimentOutlined } from "@ant-design/icons";
import { Avatar, Card, List, Space, Tag, Typography } from "antd";
import type React from "react";
import { useCallback } from "react";
import { ColorWKBlue } from "theme";
import { APIJobType } from "types/api_types";
import { useAlignmentJobContext } from "./ai_alignment_job_context";

const { Text } = Typography;

export type AlignmentTask = {
  name: string;
  comment: string;
  id: string;
  jobType: APIJobType | null;
  image: string;
  disabled?: boolean;
};

const alignmentTasks: AlignmentTask[] = [
  {
    name: "Align Sections",
    comment:
      "Align all sections of this dataset along the Z axis using features in neighboring sections. Only supported for datasets with a single tile per sections (no stitching needed).",
    id: "align-sections",
    jobType: APIJobType.ALIGN_SECTIONS,
    image: "/assets/images/align_example.png",
  },
  {
    name: "Align & stitch multiple tiles",
    comment:
      "For stitching and aligning datasets with multiple tiles per section, please contact us via email for a quote.",
    id: "align-tiles",
    disabled: true,
    jobType: null,
    image: "/assets/images/align_stitching_example.jpg",
  },
];

export const AiAlignmentModelSelector: React.FC = () => {
  const { selectedTask, setSelectedTask } = useAlignmentJobContext();

  const handleTaskSelection = useCallback(
    (item: AlignmentTask) => {
      if (!item.disabled && item.jobType) {
        setSelectedTask(item);
      }
    },
    [setSelectedTask],
  );

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <ExperimentOutlined style={{ color: ColorWKBlue }} />
          Select AI Alignment Task
        </Space>
      }
    >
      <List
        itemLayout="horizontal"
        dataSource={alignmentTasks}
        renderItem={(item) => (
          <List.Item
            className="hoverable-list-item"
            style={{
              border:
                selectedTask?.id === item.id
                  ? "1px solid var(--color-wk-blue)"
                  : "1px solid #d9d9d9",
              borderRadius: "8px",
              marginBottom: "16px",
              padding: "16px",
              opacity: item.disabled ? 0.5 : 1,
              cursor: item.disabled ? "not-allowed" : "pointer",
              transition: "background-color 0.2s ease-in-out",
            }}
            onClick={() => handleTaskSelection(item)}
          >
            <List.Item.Meta
              avatar={<Avatar shape="square" size={64} src={item.image} alt={item.name} />}
              title={
                <Space>
                  <Text strong>{item.name}</Text>
                  {item.disabled && <Tag>Coming Soon</Tag>}
                </Space>
              }
              description={item.comment}
            />
          </List.Item>
        )}
      />
    </Card>
  );
};
