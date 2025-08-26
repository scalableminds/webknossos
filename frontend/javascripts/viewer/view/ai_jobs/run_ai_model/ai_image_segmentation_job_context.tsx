import {
  APIAiModelCategory,
  runInstanceModelInferenceWithAiModelJob,
  runNeuronModelInferenceWithAiModelJob,
  startMitochondriaInferralJob,
  startNeuronInferralJob,
  startNucleiInferralJob,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { computeArrayFromBoundingBox } from "libs/utils";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobType, type AiModel } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";

interface RunAiModelJobContextType {
  selectedModel: AiModel | Partial<AiModel> | null;
  selectedJobType: APIJobType | null;
  selectedBoundingBox: UserBoundingBox | null;
  newDatasetName: string;
  selectedLayerName: string | null;
  setSelectedJobType: (jobType: APIJobType) => void;
  setSelectedModel: (model: AiModel | Partial<AiModel>, jobType: APIJobType) => void;
  setSelectedBoundingBox: (bbox: UserBoundingBox | null) => void;
  setNewDatasetName: (name: string) => void;
  setSelectedLayerName: (name: string) => void;
  handleStartAnalysis: () => void;
}

const RunAiModelJobContext = createContext<RunAiModelJobContextType | undefined>(undefined);

export const RunAiModelJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedModel, setSelectedModel] = useState<AiModel | Partial<AiModel> | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobType | null>(null);
  const [selectedBoundingBox, setSelectedBoundingBox] = useState<UserBoundingBox | null>(null);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [selectedLayerName, setSelectedLayerName] = useState<string | null>(null);

  const dispatch = useDispatch();

  const dataset = useWkSelector((state) => state.dataset);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
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
      setSelectedLayerName(colorLayers[0].name);
    }
  }, [colorLayers]);

  const handleStartAnalysis = useCallback(async () => {
    if (
      !selectedModel ||
      !selectedJobType ||
      !selectedBoundingBox ||
      !newDatasetName ||
      !selectedLayerName
    ) {
      Toast.error("Please select a model, bounding box, and provide a dataset name.");
      return;
    }

    const boundingBox = computeArrayFromBoundingBox(selectedBoundingBox.boundingBox);
    const maybeAnnotationId = isViewMode ? {} : { annotationId };

    try {
      if ("traininJob" in selectedModel) {
        // Custom models
        const commonInferenceArgs = {
          ...maybeAnnotationId,
          aiModelId: selectedModel.id as string,
          datasetDirectoryName: dataset.directoryName,
          organizationId: dataset.owningOrganization,
          colorLayerName: selectedLayerName,
          boundingBox,
          newDatasetName: newDatasetName,
        };

        if (selectedModel.category === APIAiModelCategory.EM_NUCLEI) {
          await runInstanceModelInferenceWithAiModelJob({
            ...commonInferenceArgs,
            seedGeneratorDistanceThreshold: 1000.0,
          });
        } else {
          await runNeuronModelInferenceWithAiModelJob(commonInferenceArgs);
        }
      } else {
        // Pre-trained models
        switch (selectedJobType) {
          case APIJobType.INFER_NEURONS:
            await startNeuronInferralJob(
              dataset.id,
              selectedLayerName,
              boundingBox,
              newDatasetName,
              false,
            );
            break;
          case APIJobType.INFER_MITOCHONDRIA:
            await startMitochondriaInferralJob(
              dataset.id,
              selectedLayerName,
              boundingBox,
              newDatasetName,
            );
            break;
          case APIJobType.INFER_NUCLEI:
            await startNucleiInferralJob(dataset.id, selectedLayerName, newDatasetName);
            break;
          default:
            throw new Error(`Unsupported job type: ${selectedJobType}`);
        }
      }
      Toast.success("Analysis started successfully!");
      dispatch(setAIJobModalStateAction("invisible"));
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start analysis.");
    }
  }, [
    selectedModel,
    selectedJobType,
    selectedBoundingBox,
    newDatasetName,
    selectedLayerName,
    dataset,
    isViewMode,
    annotationId,
  ]);

  const value = {
    selectedModel,
    selectedJobType,
    selectedBoundingBox,
    newDatasetName,
    selectedLayerName,
    setSelectedModel,
    setSelectedJobType,
    setSelectedBoundingBox,
    setNewDatasetName,
    setSelectedLayerName,
    handleStartAnalysis,
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
