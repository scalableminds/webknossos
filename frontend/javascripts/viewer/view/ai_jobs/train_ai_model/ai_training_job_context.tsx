import { useQuery } from "@tanstack/react-query";
import {
  type AiModelTrainingAnnotationSpecification,
  APIAiModelCategory,
  refreshOrganizationCredits,
  runInstanceModelTraining,
  runNeuronTraining,
} from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import compact from "lodash-es/compact";
import every from "lodash-es/every";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { type APIAnnotation, type APIDataset, APIJobCommand } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import { getUserBoundingBoxesFromState } from "viewer/model/accessors/tracing_accessor";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import { fetchAnnotationInfo } from "../hooks/fetch_annotation_infos";
import { getIntersectingMagList } from "../utils";
import type { AiTrainingTask } from "./ai_training_model_selector";

export interface AiTrainingAnnotationSelection {
  annotation: APIAnnotation;
  dataset: APIDataset;
  imageDataLayer?: string;
  groundTruthLayer?: string;
  magnification?: Vector3;
  userBoundingBoxes: UserBoundingBox[];
  volumeTracingMags?: Record<string, { mag: Vector3 }[]>;
}

export const applyDefaultLayers = (
  selection: AiTrainingAnnotationSelection,
): AiTrainingAnnotationSelection => {
  const { dataset, annotation, volumeTracingMags } = selection;
  let { imageDataLayer, groundTruthLayer, magnification } = selection;

  if (!imageDataLayer) {
    const colorLayers = getColorLayers(dataset).filter((layer) => layer.elementClass !== "uint24");
    if (colorLayers.length === 1) {
      imageDataLayer = colorLayers[0].name;
    }
  }

  if (!groundTruthLayer) {
    const annotationLayerNames = annotation.annotationLayers
      .filter((layer) => layer.typ === "Volume")
      .map((layer) => layer.name);
    if (annotationLayerNames.length === 1) {
      groundTruthLayer = annotationLayerNames[0];
    }
  }

  if (imageDataLayer && groundTruthLayer && !magnification) {
    const availableMagnifications = getIntersectingMagList(
      annotation,
      dataset,
      groundTruthLayer,
      imageDataLayer,
      volumeTracingMags,
    );
    if (availableMagnifications && availableMagnifications.length === 1) {
      magnification = availableMagnifications[0];
    }
  }

  return { ...selection, imageDataLayer, groundTruthLayer, magnification };
};

interface AiTrainingJobContextType {
  handleStartAnalysis: () => Promise<void>;
  selectedTask: AiTrainingTask | null;
  selectedJobType: APIJobCommand | null;
  setSelectedJobType: (jobType: APIJobCommand) => void;
  setSelectedTask: (task: AiTrainingTask) => void;

  modelName: string;
  setModelName: (name: string) => void;
  comments: string;
  setComments: (comments: string) => void;
  instanceDiameterNm: number;
  setInstanceDiameterNm: (dist: number) => void;

  selectedAnnotations: AiTrainingAnnotationSelection[];
  setSelectedAnnotations: React.Dispatch<React.SetStateAction<AiTrainingAnnotationSelection[]>>;

  handleSelectionChange: (
    annotationId: string,
    newValues: Partial<
      Pick<AiTrainingAnnotationSelection, "imageDataLayer" | "groundTruthLayer" | "magnification">
    >,
  ) => void;
  areParametersValid: boolean;
}

const AiTrainingJobContext = createContext<AiTrainingJobContextType | undefined>(undefined);

export const AiTrainingJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedTask, setSelectedTask] = useState<AiTrainingTask | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobCommand | null>(null);

  const [modelName, setModelName] = useState("");
  const [selectedAnnotations, setSelectedAnnotations] = useState<AiTrainingAnnotationSelection[]>(
    [],
  );
  const [comments, setComments] = useState("");
  const [instanceDiameterNm, setInstanceDiameterNm] = useState(1000.0);

  const dispatch = useDispatch();

  const currentAnnotation = useWkSelector((state) => state.annotation);
  const userBoundingBoxes = useWkSelector((state) => getUserBoundingBoxesFromState(state));
  const currentDataset = useWkSelector((state) => state.dataset);

  const { data: initialFullAnnotation } = useQuery({
    queryKey: ["initialAnnotation", currentAnnotation.annotationId],
    queryFn: async () => fetchAnnotationInfo(currentAnnotation.annotationId!),
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
        applyDefaultLayers({
          annotation: initialFullAnnotation.annotation,
          userBoundingBoxes: userBoundingBoxes,
          dataset: currentDataset,
          volumeTracingMags: initialFullAnnotation.volumeTracingMags,
        }),
      ]);
    }
  }, [initialFullAnnotation, userBoundingBoxes, currentDataset, selectedAnnotations.length]);

  // Auto-update the organization credit's information once an AiTrainingJobContext is created to
  // ensure most recent information about the organizations credits is displayed during ai training selection.
  useEffect(() => {
    refreshOrganizationCredits();
  }, []);

  const handleSelectionChange = useCallback(
    (
      annotationId: string,
      newValues: Partial<
        Pick<AiTrainingAnnotationSelection, "imageDataLayer" | "groundTruthLayer" | "magnification">
      >,
    ) => {
      setSelectedAnnotations((prev) => {
        const newSelections = [...prev];
        const index = newSelections.findIndex((s) => s.annotation.id === annotationId);
        if (index > -1) {
          const updatedSelection = { ...newSelections[index], ...newValues };
          // When a layer changes, reset magnification
          if (newValues.imageDataLayer || newValues.groundTruthLayer) {
            delete updatedSelection.magnification;
          }
          newSelections[index] = applyDefaultLayers(updatedSelection);
        }
        return newSelections;
      });
    },
    [],
  );

  const areSelectionsValid = selectedAnnotations.every(
    (s) => s.imageDataLayer && s.groundTruthLayer && s.magnification,
  );
  const areParametersValid = every([
    modelName,
    selectedJobType,
    areSelectionsValid,
    selectedAnnotations.length > 0,
  ]);

  const handleStartAnalysis = useCallback(async () => {
    const trainingAnnotations: AiModelTrainingAnnotationSpecification[] = compact(
      selectedAnnotations.map((selection) => {
        if (!selection.imageDataLayer || !selection.groundTruthLayer || !selection.magnification)
          return null;
        else
          return {
            annotationId: selection.annotation.id,
            colorLayerName: selection.imageDataLayer,
            segmentationLayerName: selection.groundTruthLayer,
            mag: selection.magnification,
          };
      }),
    );

    const commonJobArgmuments = {
      trainingAnnotations: trainingAnnotations,
      name: modelName,
      comment: comments,
    };

    try {
      if (selectedJobType === APIJobCommand.TRAIN_INSTANCE_MODEL) {
        await runInstanceModelTraining({
          aiModelCategory: APIAiModelCategory.EM_NUCLEI,
          instanceDiameterNm: instanceDiameterNm,
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
  }, [modelName, selectedJobType, selectedAnnotations, comments, instanceDiameterNm, dispatch]);

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
    instanceDiameterNm,
    setInstanceDiameterNm,
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
