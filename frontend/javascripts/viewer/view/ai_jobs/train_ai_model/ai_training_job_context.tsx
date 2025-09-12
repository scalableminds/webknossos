import { useQuery } from "@tanstack/react-query";
import {
  APIAiModelCategory,
  type AiModelTrainingAnnotationSpecification,
  getUnversionedAnnotationInformation,
  runInstanceModelTraining,
  runNeuronTraining,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import every from "lodash/every";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import { type APIAnnotation, type APIDataset, APIJobType } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import type { AiTrainingTask } from "./ai_training_model_selector";

export interface AiTrainingAnnotationSelection {
  annotation: APIAnnotation;
  dataset: APIDataset;
  imageDataLayer?: string;
  groundTruthLayer?: string;
  magnification?: Vector3;
  userBoundingBoxes: UserBoundingBox[];
}

interface AiTrainingJobContextType {
  handleStartAnalysis: () => void;
  selectedTask: AiTrainingTask | null;
  selectedJobType: APIJobType | null;
  setSelectedJobType: (jobType: APIJobType) => void;
  setSelectedTask: (task: AiTrainingTask) => void;

  modelName: string;
  setModelName: (name: string) => void;
  comments: string;
  setComments: (comments: string) => void;
  maxDistanceNm: number;
  setMaxDistanceNm: (dist: number) => void;

  selectedAnnotations: AiTrainingAnnotationSelection[];
  setSelectedAnnotations: React.Dispatch<React.SetStateAction<AiTrainingAnnotationSelection[]>>;
  handleSelectionChange: (
    annotationId: string,
    newValues: Partial<Omit<AiTrainingAnnotationSelection, "annotationId">>,
  ) => void;
  areParametersValid: boolean;
}

const AiTrainingJobContext = createContext<AiTrainingJobContextType | undefined>(undefined);

export const AiTrainingJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedTask, setSelectedTask] = useState<AiTrainingTask | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobType | null>(null);

  const [modelName, setModelName] = useState("");
  const [selectedAnnotations, setSelectedAnnotations] = useState<AiTrainingAnnotationSelection[]>(
    [],
  );
  const [comments, setComments] = useState("");
  const [maxDistanceNm, setMaxDistanceNm] = useState(1000.0);

  const dispatch = useDispatch();

  const currentAnnotation = useWkSelector((state) => state.annotation);
  const userBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));
  const currentDataset = useWkSelector((state) => state.dataset);

  const { data: initialFullAnnotation } = useQuery({
    queryKey: ["initialAnnotation", currentAnnotation.annotationId],
    queryFn: () => getUnversionedAnnotationInformation(currentAnnotation.annotationId!),
    enabled: !!currentAnnotation.annotationId,
  });

  useEffect(() => {
    if (
      initialFullAnnotation &&
      userBoundingBoxes &&
      currentDataset &&
      selectedAnnotations.length === 0
    ) {
      setSelectedAnnotations([
        {
          annotation: initialFullAnnotation,
          userBoundingBoxes: userBoundingBoxes,
          dataset: currentDataset,
        },
      ]);
    }
  }, [initialFullAnnotation, userBoundingBoxes, currentDataset, selectedAnnotations.length]);

  const handleSelectionChange = useCallback(
    (annotationId: string, newValues: Partial<Omit<AiTrainingAnnotationSelection, "id">>) => {
      setSelectedAnnotations((prev) => {
        const newSelections = [...prev];
        const index = newSelections.findIndex((s) => s.annotation.id === annotationId);
        if (index > -1) {
          newSelections[index] = { ...newSelections[index], ...newValues };
          // When a layer changes, reset magnification
          if (newValues.imageDataLayer || newValues.groundTruthLayer) {
            delete newSelections[index].magnification;
          }
        }
        return newSelections;
      });
    },
    [],
  );

  const areParametersValid = useMemo(() => {
    const areSelectionsValid = every(
      selectedAnnotations,
      (s) => s.imageDataLayer && s.groundTruthLayer && s.magnification,
    );

    return every([modelName, selectedJobType, areSelectionsValid, selectedAnnotations.length > 0]);
  }, [modelName, selectedJobType, selectedAnnotations]);

  const handleStartAnalysis = useCallback(async () => {
    if (!areParametersValid) {
      Toast.error("Please fill all required fields for all annotations.");
      return;
    }

    const trainingAnnotations: AiModelTrainingAnnotationSpecification[] = selectedAnnotations.map(
      (selection) => ({
        annotationId: selection.annotation.id,
        colorLayerName: selection.imageDataLayer!,
        segmentationLayerName: selection.groundTruthLayer!,
        mag: selection.magnification!,
      }),
    );

    const commonJobArgmuments = {
      trainingAnnotations: trainingAnnotations,
      name: modelName,
      comment: comments,
    };

    try {
      if (selectedJobType === APIJobType.TRAIN_INSTANCE_MODEL) {
        await runInstanceModelTraining({
          aiModelCategory: APIAiModelCategory.EM_NUCLEI,
          maxDistanceNm: maxDistanceNm,
          ...commonJobArgmuments,
        });
      } else {
        await runNeuronTraining({
          aiModelCategory: APIAiModelCategory.EM_NEURONS,
          ...commonJobArgmuments,
        });
      }
      Toast.success("The training has successfully started.");
      dispatch(setAIJobDrawerStateAction("invisible"));
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start training.");
    }
  }, [
    areParametersValid,
    modelName,
    selectedJobType,
    selectedAnnotations,
    comments,
    maxDistanceNm,
    dispatch,
  ]);

  const value = {
    selectedJobType,
    selectedTask,
    setSelectedJobType,
    setSelectedTask,
    handleStartAnalysis,
    modelName,
    setModelName,
    comments,
    setComments,
    maxDistanceNm,
    setMaxDistanceNm,
    selectedAnnotations,
    setSelectedAnnotations,
    handleSelectionChange,
    areParametersValid,
  };

  return <AiTrainingJobContext.Provider value={value}>{children}</AiTrainingJobContext.Provider>;
};

export const useAiTrainingJobContext = () => {
  const context = useContext(AiTrainingJobContext);
  if (context === undefined) {
    throw new Error("useAiTrainingJobContext must be used within a AiTrainingJobContextProvider");
  }
  return context;
};
