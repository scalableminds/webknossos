import { ExperimentOutlined } from "@ant-design/icons";
import { Avatar, Card, List, Space, Tag, Typography } from "antd";
import type React from "react";
import { useCallback } from "react";
import { ColorWKBlue } from "theme";
import { APIJobType } from "types/api_types";
import { useAiTrainingJobContext } from "./ai_training_job_context";

const { Text } = Typography;

export type AiTrainingTask = {
  name: string;
  comment: string;
  id: string;
  jobType: APIJobType | null;
  image: string;
  disabled?: boolean;
};

const trainingTasks: AiTrainingTask[] = [
  {
    name: "EM Neuron Model",
    comment:
      "EM neuron segmentation based on the annotations in this dataset. Optimized for dense neuronal tissue from SEM, FIB-SEM, SBEM, Multi-SEM microscopes.",
    id: "train-neuron-model",
    jobType: APIJobType.TRAIN_NEURON_MODEL,
    image: "/assets/images/neuron_inferral_example.jpg",
  },
  {
    name: "EM Instances Model",
    comment:
      "EM instance segmentation based on the annotations in this dataset. Optimized for nuclei, mitochondria and other cell types.",
    id: "train-instance-model",
    jobType: APIJobType.TRAIN_INSTANCE_MODEL,
    image: "/assets/images/mito_inferral_example.jpg",
  },
];

export const AiTrainingModelSelector: React.FC = () => {
  const { setSelectedJobType, selectedTask, setSelectedTask } = useAiTrainingJobContext();

  const handleTaskSelection = useCallback(
    (item: AiTrainingTask) => {
      if (!item.disabled && item.jobType) {
        setSelectedTask(item);
        setSelectedJobType(item.jobType);
      }
    },
    [setSelectedJobType, setSelectedTask],
  );

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <ExperimentOutlined style={{ color: ColorWKBlue }} />
          Select AI Training Task
        </Space>
      }
    >
      <List
        itemLayout="horizontal"
        dataSource={trainingTasks}
        renderItem={(item) => (
          <List.Item
            className={"hoverable-list-item " + (selectedTask?.id === item.id ? "selected" : "")}
            style={{
              opacity: item.disabled ? 0.5 : 1,
              cursor: item.disabled ? "not-allowed" : "pointer",
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
