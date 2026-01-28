import { ExperimentOutlined } from "@ant-design/icons";
import { APIAiModelCategory, getAiModels } from "admin/rest_api";
import { Avatar, Card, Input, List, Space, Spin, Tag, Typography } from "antd";
import Markdown from "libs/markdown_adapter";
import { useGuardedFetch } from "libs/react_helpers";
import type React from "react";
import { useMemo, useState } from "react";
import { ColorWKBlue } from "theme";
import { type AiModel, APIJobCommand } from "types/api_types";
import { useRunAiModelJobContext } from "./ai_image_segmentation_job_context";

const { Title, Text } = Typography;

type PretrainedModel = {
  name: string;
  comment: string;
  id: string;
  jobType:
    | APIJobCommand.INFER_NEURONS
    | APIJobCommand.INFER_NUCLEI
    | APIJobCommand.INFER_MITOCHONDRIA
    | APIJobCommand.INFER_INSTANCES;
  image: string;
  disabled?: boolean;
};

const preTrainedModels: PretrainedModel[] = [
  {
    name: "Neuron Segmentation",
    comment:
      "Advanced neuron segmentation and reconstruction pipeline. Optimized for dense neuronal tissue from SEM, FIB-SEM, SBEM, Multi-SEM microscopes.",
    id: "neuron-segmentation",
    jobType: APIJobCommand.INFER_NEURONS,
    image: "/images/neuron_inferral_example.jpg",
  },
  {
    name: "Mitochondria Detection",
    comment:
      "Instance segmentation model for mitochondria detection. Optimized for EM data. Powered by [MitoNet (Conrad & Narayan 2022)](https://volume-em.github.io/empanada).",
    id: "mitochondria-detection",
    jobType: APIJobCommand.INFER_MITOCHONDRIA,
    image: "/images/mito_inferral_example.jpg",
  },
  {
    name: "Nuclei Detection",
    comment: "Instance segmentation model for nuclei detection. Optimized for EM data",
    id: "nuclei-detection",
    disabled: true,
    jobType: APIJobCommand.INFER_NUCLEI,
    image: "/images/nuclei_inferral_example.jpg",
  },
];

const mapCategoryToJobType = (
  category: APIAiModelCategory,
): APIJobCommand.INFER_NEURONS | APIJobCommand.INFER_INSTANCES => {
  switch (category) {
    case APIAiModelCategory.EM_NEURONS:
      return APIJobCommand.INFER_NEURONS;
    case APIAiModelCategory.EM_NUCLEI:
      return APIJobCommand.INFER_INSTANCES;
    default:
      throw new Error(`Unsupported category: ${category}`);
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

  const onSelectModel = (model: AiModel | PretrainedModel) => {
    let jobType:
      | APIJobCommand.INFER_NEURONS
      | APIJobCommand.INFER_NUCLEI
      | APIJobCommand.INFER_MITOCHONDRIA
      | APIJobCommand.INFER_INSTANCES;
    if ("category" in model) {
      jobType = mapCategoryToJobType(model.category as APIAiModelCategory);
    } else {
      // Hard-coded, pre-trained models
      jobType = model.jobType;
    }

    setSelectedModel(model);
    setSelectedJobType(jobType);
  };

  const filterModels = <T extends AiModel | PretrainedModel>(models: T[]) => {
    if (!searchTerm) {
      return models;
    }
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return models.filter(
      (model) =>
        model.name?.toLowerCase().includes(lowerCaseSearchTerm) ||
        model.comment?.toLowerCase().includes(lowerCaseSearchTerm),
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered models need an update after searchTerm changes
  const filteredPreTrainedModels = useMemo(() => filterModels(preTrainedModels), [searchTerm]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered models need an update after searchTerm changes
  const filteredCustomModels = useMemo(
    () => filterModels(customModels),
    [searchTerm, customModels],
  );

  const switchToTrainingButton = (
    <>
      You don't have any custom models yet. Training custom models on your data is coming soon.
      {/* <Button onClick={() => dispatch(setAIJobDrawerStateAction("open_ai_training"))} type="link">
        Train an AI Model on your data
      </Button> */}
    </>
  );

  return (
    <Card
      type="inner"
      title={
        <Space align="center">
          <ExperimentOutlined style={{ color: ColorWKBlue }} />
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
        locale={{ emptyText: "No pre-trained models match your search." }}
        renderItem={(item) => (
          <List.Item
            style={{
              opacity: item.disabled ? 0.5 : 1,
              cursor: item.disabled ? "not-allowed" : "pointer",
            }}
            className={"hoverable-list-item " + (selectedModel?.id === item.id ? "selected" : "")}
            onClick={() => !item.disabled && onSelectModel(item)}
          >
            <List.Item.Meta
              avatar={
                <Avatar
                  shape="square"
                  size={64}
                  src={(item as PretrainedModel).image}
                  alt={item.name}
                />
              }
              title={
                <Space>
                  <Text strong>{item.name}</Text>
                  {item.disabled && <Tag>Coming Soon</Tag>}
                </Space>
              }
              description={<Markdown>{item.comment}</Markdown>}
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
          locale={{
            emptyText:
              searchTerm.length > 0 ? "No models match your search." : switchToTrainingButton,
          }}
          style={{ maxHeight: 360, overflowY: "auto" }}
          renderItem={(item) => (
            <List.Item
              className={"hoverable-list-item " + (selectedModel?.id === item.id ? "selected" : "")}
              style={{
                border:
                  selectedModel?.id === item.id ? `1px solid ${ColorWKBlue}` : "1px solid #d9d9d9",
                borderRadius: 8,
                marginBottom: 16,
                padding: 16,
                cursor: "pointer",
              }}
              onClick={() => onSelectModel(item)}
            >
              <List.Item.Meta
                avatar={
                  <Avatar shape="square" size={64}>
                    {item.name!.charAt(0)}
                  </Avatar>
                }
                title={
                  <Space>
                    <Text strong>{item.name}</Text>
                    <Tag>
                      {(item as AiModel).category === APIAiModelCategory.EM_NEURONS
                        ? "NEURONS"
                        : "INSTANCES"}
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
