import { ExperimentOutlined } from "@ant-design/icons";
import mitoInferralExample from "@images/mito-inferral-example.jpg";
import neuronInferralExample from "@images/neuron-inferral-example.jpg";
import nucleiInferralExample from "@images/nuclei-inferral-example.jpg";
import somaInferralExample from "@images/soma-inferral-example.png";
import { APIAiModelCategory, getAiModels } from "admin/rest_api";
import { Avatar, Card, Input, List, Space, Spin, Tag, Typography } from "antd";
import Markdown from "libs/markdown_adapter";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useMemo, useState } from "react";
import { ColorWKBlue } from "theme";
import { type AiModel, APIJobCommand } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { useRunAiModelJobContext } from "./ai_image_segmentation_job_context";

const { Title, Text } = Typography;

const categoryToImage: Partial<Record<APIAiModelCategory, string>> = {
  [APIAiModelCategory.EM_NEURONS]: neuronInferralExample,
  [APIAiModelCategory.EM_NUCLEI]: nucleiInferralExample,
  [APIAiModelCategory.EM_SOMATA]: somaInferralExample,
  [APIAiModelCategory.EM_MITOCHONDRIA]: mitoInferralExample,
};

const mapCategoryToJobType = (
  category: APIAiModelCategory,
):
  | APIJobCommand.INFER_NEURONS
  | APIJobCommand.INFER_MITOCHONDRIA
  | APIJobCommand.INFER_INSTANCES => {
  switch (category) {
    case APIAiModelCategory.EM_NEURONS:
      return APIJobCommand.INFER_NEURONS;
    case APIAiModelCategory.EM_MITOCHONDRIA:
      return APIJobCommand.INFER_MITOCHONDRIA;
    case APIAiModelCategory.EM_NUCLEI:
    case APIAiModelCategory.EM_GENERIC:
    case APIAiModelCategory.EM_SOMATA:
      return APIJobCommand.INFER_INSTANCES;
    default:
      throw new Error(`Unsupported category: ${category}`);
  }
};

export const AiModelSelector: React.FC = () => {
  const { selectedModel, setSelectedModel, setSelectedJobType } = useRunAiModelJobContext();
  const [searchTerm, setSearchTerm] = useState("");
  const isSuperUser = useWkSelector((state) => enforceActiveUser(state.activeUser).isSuperUser);

  const { data: allModels = [], isLoading } = useQueryWithErrorHandling(
    {
      queryKey: ["aiModels"],
      queryFn: async () => {
        const models = await getAiModels();
        return models.filter((aiModel) => (isSuperUser ? true : !aiModel.isSuperUserOnly));
      },
    },
    "Could not load model list.",
  );

  const pretrainedModels = useMemo(() => allModels.filter((m) => m.isPretrainedModel), [allModels]);
  const customModels = useMemo(() => allModels.filter((m) => !m.isPretrainedModel), [allModels]);

  const onSelectModel = (model: AiModel) => {
    if (!model.category) return;
    const jobType = mapCategoryToJobType(model.category);
    setSelectedModel(model);
    setSelectedJobType(jobType);
  };

  const filterModels = (models: AiModel[]) => {
    if (!searchTerm) return models;
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return models.filter(
      (model) =>
        model.name?.toLowerCase().includes(lowerCaseSearchTerm) ||
        model.comment?.toLowerCase().includes(lowerCaseSearchTerm),
    );
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: filtered models need an update after searchTerm changes
  const filteredPretrainedModels = useMemo(
    () => filterModels(pretrainedModels),
    [searchTerm, pretrainedModels],
  );
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
      {isLoading ? (
        <Spin />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={filteredPretrainedModels}
          locale={{ emptyText: "No pre-trained models match your search." }}
          renderItem={(item) => {
            const previewImage = item.category ? categoryToImage[item.category] : undefined;
            return (
              <List.Item
                style={{ cursor: "pointer" }}
                className={
                  "hoverable-list-item " + (selectedModel?.id === item.id ? "selected" : "")
                }
                onClick={() => onSelectModel(item)}
              >
                <List.Item.Meta
                  avatar={<Avatar shape="square" size={64} src={previewImage} alt={item.name} />}
                  title={<Text strong>{item.name}</Text>}
                  description={<Markdown>{item.comment}</Markdown>}
                />
              </List.Item>
            );
          }}
        />
      )}

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
