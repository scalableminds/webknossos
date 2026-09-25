import mitoInferralExample from "@images/mito-inferral-example.jpg";
import neuronInferralExample from "@images/neuron-inferral-example.jpg";
import type React from "react";
import { useCallback } from "react";
import { APIJobCommand } from "types/api_types";
import { JobSection } from "../components/job_section";
import { SelectableTile, TileGrid } from "../components/selectable_tile";
import { useAiTrainingJobContext } from "./ai_training_job_context";

export type AiTrainingTask = {
  name: string;
  comment: string;
  id: string;
  jobType: APIJobCommand | null;
  image: string;
  disabled?: boolean;
};

const trainingTasks: AiTrainingTask[] = [
  {
    name: "EM Neuron Model",
    comment:
      "EM neuron segmentation based on the annotations in this dataset. Optimized for dense neuronal tissue from SEM, FIB-SEM, SBEM, Multi-SEM microscopes.",
    id: "train-neuron-model",
    jobType: APIJobCommand.TRAIN_NEURON_MODEL,
    image: neuronInferralExample,
  },
  {
    name: "EM Instances Model",
    comment:
      "EM instance segmentation based on the annotations in this dataset. Optimized for nuclei, mitochondria and other cell types.",
    id: "train-instance-model",
    jobType: APIJobCommand.TRAIN_INSTANCE_MODEL,
    image: mitoInferralExample,
  },
];

export const AiTrainingModelSelector: React.FC = () => {
  const { setSelectedJobType, selectedTask, setSelectedTask, stepStatuses } =
    useAiTrainingJobContext();

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
    <JobSection
      step={1}
      title="Select training task"
      description="What kind of structure should the model learn?"
      status={stepStatuses.task}
    >
      <TileGrid label="Training tasks">
        {trainingTasks.map((task) => (
          <SelectableTile
            key={task.id}
            image={task.image}
            title={task.name}
            description={task.comment}
            isSelected={selectedTask?.id === task.id}
            isDisabled={task.disabled}
            onSelect={() => handleTaskSelection(task)}
          />
        ))}
      </TileGrid>
    </JobSection>
  );
};
