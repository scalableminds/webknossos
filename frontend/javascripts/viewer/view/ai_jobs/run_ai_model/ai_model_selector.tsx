import { ExperimentOutlined } from "@ant-design/icons";
import { APIAiModelCategory, getAiModels } from "admin/rest_api";
import { Avatar, Card, Input, List, Space, Spin, Tag, Typography } from "antd";
import { useGuardedFetch } from "libs/react_helpers";
import type React from "react";
import { useMemo, useState } from "react";
import { APIJobType, type AiModel } from "types/api_types";
import { useRunAiModelJobContext } from "./ai_image_segmentation_job_context";

const { Title, Text } = Typography;

const preTrainedModels: (Partial<AiModel> & {
  jobType: APIJobType;
  image: string;
  disabled?: boolean;
})[] = [
  {
    name: "Neuron Segmentation",
    comment: "Advanced neuron segmentation for EM data",
    id: "neuron-segmentation",
    jobType: APIJobType.INFER_NEURONS,
    image: "/assets/images/neuron_inferral_example.jpg",
  },
  {
    name: "Mitochondria Detection",
    comment: "Precise mitochondria detection for EM data",
    id: "mitochondria-detection",
    jobType: APIJobType.INFER_MITOCHONDRIA,
    image: "/assets/images/mito_inferral_example.jpg",
  },
  {
    name: "Nuclei Detection",
    comment: "Multi-scale nuclei detection",
    id: "nuclei-detection",
    disabled: true,
    jobType: APIJobType.INFER_NUCLEI,
    image: "/assets/images/nuclei_inferral_example.jpg",
  },
];

const mapCategoryToJobType = (category: APIAiModelCategory): APIJobType => {
  switch (category) {
    case APIAiModelCategory.EM_NEURONS:
      return APIJobType.INFER_NEURONS;
    case APIAiModelCategory.EM_NUCLEI:
      return APIJobType.INFER_NUCLEI;
    default:
      // Fallback or throw error
      return APIJobType.INFER_NEURONS;
  }
};

export const AiModelSelector: React.FC = () => {
  const { selectedModel, setSelectedModel, setSelectedJobType } = useRunAiModelJobContext();
  const [searchTerm, setSearchTerm] = useState("");

  const [customModels, isLoading] = useGuardedFetch(
    async function () {
      const models = await getAiModels();
      return models.filter(
        (aiModel) => aiModel.trainingJob == null || aiModel.trainingJob.state === "SUCCESS",
      );
    },
    [] as AiModel[],
    [],
    "Could not load model list.",
  );

  const onSelectModel = (model: AiModel | (Partial<AiModel> & { jobType?: APIJobType })) => {
    let jobType: APIJobType;
    if ("category" in model) {
      jobType = mapCategoryToJobType(model.category as APIAiModelCategory);
    } else {
      // Hard-coded, pre-trained models
      jobType = model.jobType;
    }

    setSelectedModel(model);
    setSelectedJobType(jobType as APIJobType);
  };

  const filterModels = (models: (AiModel | (Partial<AiModel> & { jobType?: APIJobType }))[]) => {
    if (!searchTerm) {
      return models;
    }
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(lowerCaseSearchTerm) ||
        (model.comment && model.comment.toLowerCase().includes(lowerCaseSearchTerm)),
    );
  };

  const filteredPreTrainedModels = useMemo(() => filterModels(preTrainedModels), [searchTerm]);
  const filteredCustomModels = useMemo(
    () => filterModels(customModels),
    [searchTerm, customModels],
  );

  return (
    <Card
      title={
        <Space align="center">
          <ExperimentOutlined style={{ color: "#1890ff" }} />
          Select AI Model
        </Space>
      }
      extra={
        <Input.Search
          placeholder="Search models..."
          style={{ width: 300 }}
          onChange={(e) => setSearchTerm(e.target.value)}
          value={searchTerm}
        />
      }
    >
      <Title level={5}>Pre-trained Models</Title>
      <List
        itemLayout="horizontal"
        dataSource={filteredPreTrainedModels}
        renderItem={(item) => (
          <List.Item
            style={{
              border: selectedModel?.id === item.id ? "1px solid #1890ff" : "1px solid #d9d9d9",
              borderRadius: "8px",
              marginBottom: "16px",
              padding: "16px",
              opacity: item.disabled ? 0.5 : 1,
              cursor: item.disabled ? "not-allowed" : "pointer",
            }}
            onClick={() => !item.disabled && onSelectModel(item)}
          >
            <List.Item.Meta
              avatar={
                <Avatar shape="square" size={64} src={<img src={item.image} alt={item.name} />} />
              }
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

      <Title level={5} style={{ marginTop: "24px" }}>
        Your Custom Models
      </Title>
      {isLoading ? (
        <Spin />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={filteredCustomModels}
          renderItem={(item) => (
            <List.Item
              style={{
                border: selectedModel?.id === item.id ? "1px solid #1890ff" : "1px solid #d9d9d9",
                borderRadius: "8px",
                marginBottom: "16px",
                padding: "16px",
                cursor: "pointer",
              }}
              onClick={() => onSelectModel(item)}
            >
              <List.Item.Meta
                avatar={
                  <Avatar shape="square" size={64}>
                    {item.name.charAt(0)}
                  </Avatar>
                }
                title={
                  <Space>
                    <Text strong>{item.name}</Text>
                    <Tag>
                      {item.category === APIAiModelCategory.EM_NEURONS ? "NEURONS" : "INSTANCES"}
                    </Tag>
                  </Space>
                }
                description={item.comment}
              />
            </List.Item>
          )}
        />
      )}
    </Card>
  );
};
