import {
  APIAiModelCategory,
  type AiModelTrainingAnnotationSpecification,
  runInstanceModelTraining,
  runNeuronTraining,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { type APIAnnotation, APIJobType } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import type { AnnotationInfoForAITrainingJob } from "viewer/view/action-bar/ai_job_modals/utils";
import type { AiTrainingTask } from "./ai_training_model_selector";

export interface AiTrainingAnnotationSelection {
  annotationId: string;
  imageDataLayer?: string;
  groundTruthLayer?: string;
  magnification?: Vector3;
}

interface AiTrainingJobContextType {
  handleStartAnalysis: () => void;
  selectedTask: AiTrainingTask | null;
  selectedJobType: APIJobType | null;
  setSelectedJobType: (jobType: APIJobType) => void;
  setSelectedTask: (task: AiTrainingTask) => void;
  selectedBoundingBoxes: UserBoundingBox[] | null;

  modelName: string;
  setModelName: (name: string) => void;
  comments: string;
  setComments: (comments: string) => void;
  maxDistanceNm: number;
  setMaxDistanceNm: (dist: number) => void;

  annotationInfos: AnnotationInfoForAITrainingJob<APIAnnotation>[];
  selections: AiTrainingAnnotationSelection[];
  handleSelectionChange: (
    annotationId: string,
    newValues: Partial<Omit<AiTrainingAnnotationSelection, "annotationId">>,
  ) => void;
}

const AiTrainingJobContext = createContext<AiTrainingJobContextType | undefined>(undefined);

export const AiTrainingJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedTask, setSelectedTask] = useState<AiTrainingTask | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobType | null>(null);

  const [modelName, setModelName] = useState("");
  const [annotationInfos, setAnnotationInfos] = useState<
    AnnotationInfoForAITrainingJob<APIAnnotation>[]
  >([]);
  const [selections, setSelections] = useState<AiTrainingAnnotationSelection[]>([]);
  const [comments, setComments] = useState("");
  const [maxDistanceNm, setMaxDistanceNm] = useState(1000.0);

  const dispatch = useDispatch();

  const annotation = useWkSelector((state) => state.annotation);
  const dataset = useWkSelector((state) => state.dataset);
  const userBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));

  useEffect(() => {
    // Initialize with current annotation if nothing is selected
    if (annotationInfos.length === 0 && userBoundingBoxes) {
      if (dataset) {
        setAnnotationInfos([
          {
            annotation: annotation as unknown as APIAnnotation,
            dataset,
            volumeTracings: annotation.volumes,
            volumeTracingMags: [],
            userBoundingBoxes,
          },
        ]);
      }
    }
  }, [annotation, dataset, userBoundingBoxes, annotationInfos.length]);

  useEffect(() => {
    if (annotationInfos) {
      setSelections(
        annotationInfos.map((info) => ({
          annotationId: "id" in info.annotation ? info.annotation.id : info.annotation.annotationId,
        })),
      );
    }
  }, [annotationInfos]);

  const handleSelectionChange = useCallback(
    (
      annotationId: string,
      newValues: Partial<Omit<AiTrainingAnnotationSelection, "annotationId">>,
    ) => {
      setSelections((prev) => {
        const newSelections = [...prev];
        const index = newSelections.findIndex((s) => s.annotationId === annotationId);
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

  const handleStartAnalysis = useCallback(async () => {
    if (!modelName || !selectedJobType) {
      Toast.error("Please fill all required fields.");
      return;
    }

    if (selections.some((s) => !s.imageDataLayer || !s.groundTruthLayer || !s.magnification)) {
      Toast.error("Please fill all required fields for all annotations.");
      return;
    }

    const trainingAnnotations: AiModelTrainingAnnotationSpecification[] = selections.map(
      (selection) => ({
        annotationId: selection.annotationId,
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
      dispatch(setAIJobModalStateAction("invisible"));
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start training.");
    }
  }, [modelName, selectedJobType, selections, comments, maxDistanceNm, dispatch]);

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
    annotationInfos,
    selections,
    handleSelectionChange,
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
