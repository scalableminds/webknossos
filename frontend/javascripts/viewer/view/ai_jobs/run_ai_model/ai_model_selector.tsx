import { SearchOutlined } from "@ant-design/icons";
import mitoInferralExample from "@images/mito-inferral-example.jpg";
import neuronInferralExample from "@images/neuron-inferral-example.jpg";
import nucleiInferralExample from "@images/nuclei-inferral-example.jpg";
import somaInferralExample from "@images/soma-inferral-example.png";
import { APIAiModelCategory, getAiModels } from "admin/rest_api";
import { Avatar, Flex, Input, Space, Spin, Tag, Typography } from "antd";
import Markdown from "libs/markdown_adapter";
import { useQueryWithErrorHandling, useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useMemo, useState } from "react";
import { type AiModel, APIJobCommand } from "types/api_types";
import { enforceActiveUser } from "viewer/model/accessors/user_accessor";
import { JobSection } from "../components/job_section";
import {
  SelectableRow,
  SelectableTile,
  TileGrid,
  TileGroupLabel,
} from "../components/selectable_tile";
import { useRunAiModelJobContext } from "./ai_image_segmentation_job_context";

const { Text } = Typography;

const categoryToImage: Partial<Record<APIAiModelCategory, string>> = {
  [APIAiModelCategory.EM_NEURONS]: neuronInferralExample,
  [APIAiModelCategory.EM_NUCLEI]: nucleiInferralExample,
  [APIAiModelCategory.EM_SOMATA]: somaInferralExample,
  [APIAiModelCategory.EM_MITOCHONDRIA]: mitoInferralExample,
};

// Renders paragraphs inline so that the tile can clamp the description to two lines.
const INLINE_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
  const { selectedModel, setSelectedModel, setSelectedJobType, stepStatuses } =
    useRunAiModelJobContext();
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

  const pretrainedModels = useMemo(() => allModels.filter((m) => m.isPretrained), [allModels]);
  const customModels = useMemo(() => allModels.filter((m) => !m.isPretrained), [allModels]);

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

  const noCustomModelsText =
    searchTerm.length > 0
      ? "No models match your search."
      : "You don't have any custom models yet. Training custom models on your data is coming soon.";

  return (
    <JobSection
      step={1}
      title="Select AI model"
      description="Pick a pre-trained model or one you trained yourself."
      status={stepStatuses.model}
      extra={
        <Input
          placeholder="Search models…"
          prefix={<SearchOutlined />}
          allowClear
          style={{ width: 240 }}
          onChange={(e) => setSearchTerm(e.target.value)}
          value={searchTerm}
        />
      }
    >
      {isLoading ? (
        <Spin />
      ) : (
        <>
          <TileGroupLabel title="Pre-trained models" count={filteredPretrainedModels.length} />
          {filteredPretrainedModels.length === 0 ? (
            <Text type="secondary">No pre-trained models match your search.</Text>
          ) : (
            <TileGrid label="Pre-trained models">
              {filteredPretrainedModels.map((model) => (
                <SelectableTile
                  key={model.id}
                  image={model.category ? categoryToImage[model.category] : undefined}
                  title={model.name}
                  description={
                    <Markdown components={INLINE_MARKDOWN_COMPONENTS}>{model.comment}</Markdown>
                  }
                  clampDescription
                  isSelected={selectedModel?.id === model.id}
                  onSelect={() => onSelectModel(model)}
                />
              ))}
            </TileGrid>
          )}

          <div style={{ marginTop: 20 }}>
            <TileGroupLabel title="Your custom models" count={filteredCustomModels.length} />
          </div>
          {filteredCustomModels.length === 0 ? (
            <Text type="secondary">{noCustomModelsText}</Text>
          ) : (
            <Flex
              vertical
              gap="small"
              role="radiogroup"
              aria-label="Your custom models"
              style={{ maxHeight: 360, overflowY: "auto" }}
            >
              {filteredCustomModels.map((model) => (
                <SelectableRow
                  key={model.id}
                  avatar={
                    <Avatar shape="square" size={40}>
                      {model.name.charAt(0)}
                    </Avatar>
                  }
                  title={
                    <Space size="small">
                      <Text strong>{model.name}</Text>
                      <Tag>
                        {model.category === APIAiModelCategory.EM_NEURONS ? "NEURONS" : "INSTANCES"}
                      </Tag>
                    </Space>
                  }
                  description={
                    model.comment ? (
                      <Markdown components={INLINE_MARKDOWN_COMPONENTS}>{model.comment}</Markdown>
                    ) : null
                  }
                  isSelected={selectedModel?.id === model.id}
                  onSelect={() => onSelectModel(model)}
                />
              ))}
            </Flex>
          )}
        </>
      )}
    </JobSection>
  );
};
