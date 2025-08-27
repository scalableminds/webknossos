import {
  APIAiModelCategory,
  type AiModelTrainingAnnotationSpecification,
  runInstanceModelTraining,
  runNeuronTraining,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type React from "react";
import { createContext, useCallback, useContext, useState } from "react";
import { useDispatch } from "react-redux";
import { APIJobType } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { setAIJobModalStateAction } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import type { AiTrainingTask } from "./ai_training_model_selector";

interface AiTrainingJobContextType {
  handleStartAnalysis: () => void;
  selectedTask: AiTrainingTask | null;
  selectedJobType: APIJobType | null;
  setSelectedJobType: (jobType: APIJobType) => void;
  setSelectedTask: (task: AiTrainingTask) => void;
  selectedBoundingBoxes: UserBoundingBox[] | null;

  modelName: string;
  setModelName: (name: string) => void;
  imageDataLayer: string | null;
  setImageDataLayer: (layer: string) => void;
  groundTruthLayer: string | null;
  setGroundTruthLayer: (layer: string) => void;
  magnification: Vector3 | null;
  setMagnification: (mag: Vector3) => void;
  comments: string;
  setComments: (comments: string) => void;
  maxDistanceNm: number;
  setMaxDistanceNm: (dist: number) => void;
}

const AiTrainingJobContext = createContext<AiTrainingJobContextType | undefined>(undefined);

export const AiTrainingJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedTask, setSelectedTask] = useState<AiTrainingTask | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobType | null>(null);

  const [modelName, setModelName] = useState("");
  const [imageDataLayer, setImageDataLayer] = useState<string | null>(null);
  const [groundTruthLayer, setGroundTruthLayer] = useState<string | null>(null);
  const [magnification, setMagnification] = useState<Vector3 | null>(null);
  const [comments, setComments] = useState("");
  const [maxDistanceNm, setMaxDistanceNm] = useState(1000.0);

  const dispatch = useDispatch();

  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const selectedBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));

  // const selectedBoundingBox = getSomeTracing(annotation).userBoundingBoxes.flatMap(
  //   ({ userBoundingBoxes, annotation }) => {
  //     const annotationId = "id" in annotation ? annotation.id : annotation.annotationId;
  //     return userBoundingBoxes.map((box) => ({
  //       ...box,
  //       annotationId: annotationId,
  //       trainingMag: trainingAnnotationsInfo?.find(
  //         (formInfo) => formInfo.annotationId === annotationId,
  //       )?.mag,
  //     }));
  //   },
  // );

  const handleStartAnalysis = useCallback(async () => {
    if (!modelName || !selectedJobType || !imageDataLayer || !groundTruthLayer || !magnification) {
      Toast.error("Please fill all required fields.");
      return;
    }

    const trainingAnnotations: AiModelTrainingAnnotationSpecification[] = [
      {
        annotationId: annotationId,
        colorLayerName: imageDataLayer,
        segmentationLayerName: groundTruthLayer,
        mag: magnification,
      },
    ];

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
  }, [
    modelName,
    selectedTask,
    imageDataLayer,
    groundTruthLayer,
    magnification,
    comments,
    maxDistanceNm,
    annotationId,
    dispatch,
  ]);

  const value = {
    selectedJobType,
    selectedTask,
    selectedBoundingBoxes,
    setSelectedJobType,
    setSelectedTask,
    handleStartAnalysis,
    modelName,
    setModelName,
    imageDataLayer,
    setImageDataLayer,
    groundTruthLayer,
    setGroundTruthLayer,
    magnification,
    setMagnification,
    comments,
    setComments,
    maxDistanceNm,
    setMaxDistanceNm,
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
