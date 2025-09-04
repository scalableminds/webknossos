import {
  APIAiModelCategory,
  type BaseCustomModelInferenceParameters,
  runCustomInstanceModelInferenceJob,
  runCustomNeuronModelInferenceJob,
  runPretrainedMitochondriaInferenceJob,
  runPretrainedNeuronInferencelJob,
  runPretrainedNucleiInferenceJob,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { computeArrayFromBoundingBox } from "libs/utils";
import messages from "messages";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { type APIDataLayer, APIJobType, type AiModel } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import { hasEmptyTrees } from "viewer/model/accessors/skeletontracing_accessor";
import {
  getTaskBoundingBoxes,
  getUserBoundingBoxesFromState,
} from "viewer/model/accessors/tracing_accessor";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import { Model } from "viewer/singletons";
import type { UserBoundingBox } from "viewer/store";
import type { SplitMergerEvaluationSettings } from "viewer/view/action-bar/ai_job_modals/components/collapsible_split_merger_evaluation_settings";

interface RunAiModelJobContextType {
  selectedModel: AiModel | Partial<AiModel> | null;
  selectedJobType: APIJobType | null;
  selectedBoundingBox: UserBoundingBox | null;
  newDatasetName: string;
  selectedLayer: APIDataLayer | null;
  seedGeneratorDistanceThreshold: number;
  isEvaluationActive: boolean;
  splitMergerEvaluationSettings: SplitMergerEvaluationSettings;
  setSelectedJobType: (jobType: APIJobType) => void;
  setSelectedModel: (model: AiModel | Partial<AiModel>) => void;
  setSelectedBoundingBox: (bbox: UserBoundingBox | null) => void;
  setNewDatasetName: (name: string) => void;
  setSelectedLayer: (layer: APIDataLayer) => void;
  setSeedGeneratorDistanceThreshold: (threshold: number) => void;
  setIsEvaluationActive: (isActive: boolean) => void;
  setSplitMergerEvaluationSettings: (settings: SplitMergerEvaluationSettings) => void;
  handleStartAnalysis: () => void;
  areParametersValid: boolean;
}

const RunAiModelJobContext = createContext<RunAiModelJobContextType | undefined>(undefined);

/**
 * Context provider supplying state and actions for running AI image segmentation/inference jobs.
 *
 * Manages selected model, job type, bounding box, output dataset name, color layer,
 * evaluation options, and exposes a handler to start the analysis. Components within
 * this provider can read/update these values via `useRunAiModelJobContext`.
 */
export const RunAiModelJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedModel, setSelectedModel] = useState<AiModel | Partial<AiModel> | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobType | null>(null);
  const [selectedBoundingBox, setSelectedBoundingBox] = useState<UserBoundingBox | null>(null);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [selectedLayer, setSelectedLayer] = useState<APIDataLayer | null>(null);
  const [seedGeneratorDistanceThreshold, setSeedGeneratorDistanceThreshold] = useState(1000.0);
  const [isEvaluationActive, setIsEvaluationActive] = useState(false);
  const [splitMergerEvaluationSettings, setSplitMergerEvaluationSettings] =
    useState<SplitMergerEvaluationSettings>({
      useSparseTracing: true,
      sparseTubeThresholdInNm: 1000,
      minimumMergerPathLengthInNm: 800,
    });

  const dispatch = useDispatch();

  const skeletonAnnotation = useWkSelector((state) => state.annotation.skeleton);
  const userBoundingBoxCount = useWkSelector(
    (state) => getUserBoundingBoxesFromState(state).length,
  );
  const taskBoundingBoxes = useWkSelector(getTaskBoundingBoxes);
  const dataset = useWkSelector((state) => state.dataset);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const datasetConfiguration = useWkSelector((state) => state.datasetConfiguration);
  const isViewMode = useWkSelector(
    (state) => state.temporaryConfiguration.controlMode === ControlModeEnum.VIEW,
  );
  const colorLayers = getColorLayers(dataset);

  useEffect(() => {
    if (dataset && selectedModel) {
      setNewDatasetName(`${dataset.name}_${selectedModel.name?.replace(/\s/g, "_")}`);
    }
  }, [dataset, selectedModel]);

  useEffect(() => {
    if (colorLayers.length > 0) {
      setSelectedLayer(colorLayers[0]);
    }
  }, [colorLayers]);

  const areParametersValid = useMemo(
    () =>
      Boolean(
        selectedModel && selectedJobType && selectedBoundingBox && newDatasetName && selectedLayer,
      ),
    [selectedModel, selectedJobType, selectedBoundingBox, newDatasetName, selectedLayer],
  );

  const handleStartAnalysis = useCallback(async () => {
    if (!areParametersValid) {
      Toast.error("Please select a model, bounding box, and provide a dataset name.");
      return;
    }

    await Model.ensureSavedState();

    const boundingBox = computeArrayFromBoundingBox(selectedBoundingBox!.boundingBox);
    const maybeAnnotationId = isViewMode ? {} : { annotationId };

    if (isEvaluationActive) {
      if (userBoundingBoxCount > 1) {
        Toast.error(messages["jobs.wrongNumberOfBoundingBoxes"]);
        return;
      }

      if (Object.values(taskBoundingBoxes).length + userBoundingBoxCount !== 1) {
        Toast.error(messages["jobs.wrongNumberOfBoundingBoxes"]);
        return;
      }

      if (skeletonAnnotation == null || skeletonAnnotation.trees.size() === 0) {
        Toast.error("Please ensure that a skeleton tree exists within the selected bounding box.");
        return;
      }
      if (skeletonAnnotation && hasEmptyTrees(skeletonAnnotation.trees)) {
        Toast.error("Please ensure that all skeleton trees in this annotation have some nodes.");
        return;
      }
    }

    const isColorLayerInverted = datasetConfiguration.layers[selectedLayer!.name].isInverted;

    try {
      if ("trainingJob" in selectedModel!) {
        // Custom models
        const commonInferenceArgs: BaseCustomModelInferenceParameters = {
          ...maybeAnnotationId,
          aiModelId: selectedModel!.id as string,
          datasetDirectoryName: dataset.directoryName,
          organizationId: dataset.owningOrganization,
          colorLayerName: selectedLayer!.name,
          boundingBox,
          newDatasetName: newDatasetName,
          invertColorLayer: isColorLayerInverted,
        };

        if (selectedModel!.category === APIAiModelCategory.EM_NUCLEI) {
          await runCustomInstanceModelInferenceJob({
            ...commonInferenceArgs,
            seedGeneratorDistanceThreshold: seedGeneratorDistanceThreshold,
          });
        } else {
          await runCustomNeuronModelInferenceJob({
            ...commonInferenceArgs,
          });
        }
      } else {
        // Pre-trained models
        switch (selectedJobType) {
          case APIJobType.INFER_NEURONS:
            await runPretrainedNeuronInferencelJob(
              dataset.id,
              selectedLayer!.name,
              boundingBox,
              newDatasetName,
              isColorLayerInverted,
              isEvaluationActive,
              isEvaluationActive ? annotationId : undefined,
              isEvaluationActive ? splitMergerEvaluationSettings : undefined,
            );
            break;
          case APIJobType.INFER_MITOCHONDRIA:
            await runPretrainedMitochondriaInferenceJob(
              dataset.id,
              selectedLayer!.name,
              boundingBox,
              newDatasetName,
            );
            break;
          case APIJobType.INFER_NUCLEI:
            await runPretrainedNucleiInferenceJob(
              dataset.id,
              selectedLayer!.name,
              newDatasetName,
              isColorLayerInverted,
            );
            break;
          default:
            throw new Error(`Unsupported job type: ${selectedJobType}`);
        }
      }
      Toast.success("Analysis started successfully!");
      dispatch(setAIJobDrawerStateAction("invisible"));
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start analysis.");
    }
  }, [
    areParametersValid,
    selectedModel,
    selectedJobType,
    selectedBoundingBox,
    newDatasetName,
    selectedLayer,
    dataset,
    isViewMode,
    annotationId,
    seedGeneratorDistanceThreshold,
    isEvaluationActive,
    splitMergerEvaluationSettings,
    userBoundingBoxCount,
    taskBoundingBoxes,
    skeletonAnnotation,
    datasetConfiguration,
    dispatch,
  ]);

  const value = {
    selectedModel,
    selectedJobType,
    selectedBoundingBox,
    newDatasetName,
    selectedLayer,
    seedGeneratorDistanceThreshold,
    isEvaluationActive,
    splitMergerEvaluationSettings,
    setSelectedModel,
    setSelectedJobType,
    setSelectedBoundingBox,
    setNewDatasetName,
    setSelectedLayer,
    setSeedGeneratorDistanceThreshold,
    setIsEvaluationActive,
    setSplitMergerEvaluationSettings,
    handleStartAnalysis,
    areParametersValid,
  };

  return <RunAiModelJobContext.Provider value={value}>{children}</RunAiModelJobContext.Provider>;
};

export const useRunAiModelJobContext = () => {
  const context = useContext(RunAiModelJobContext);
  if (context === undefined) {
    throw new Error("useAiJobsContext must be used within a AiJobsContextProvider");
  }
  return context;
};
