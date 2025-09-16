import { startAlignSectionsJob } from "admin/rest_api";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIJobType } from "types/api_types";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import { setAIJobDrawerStateAction } from "viewer/model/actions/ui_actions";
import type { UserBoundingBox } from "viewer/store";
import { getBoundingBoxesForLayers } from "viewer/view/ai_jobs/utils";
import type { AlignmentTask } from "./ai_alignment_model_selector";

interface AlignmentJobContextType {
  handleStartAnalysis: () => void;
  newDatasetName: string;
  selectedTask: AlignmentTask | null;
  selectedJobType: APIJobType | null;
  setSelectedJobType: (jobType: APIJobType) => void;
  setSelectedTask: (task: AlignmentTask) => void;
  selectedBoundingBox: UserBoundingBox | null;
  setNewDatasetName: (name: string) => void;
  shouldUseManualMatches: boolean;
  setShouldUseManualMatches: (shouldUseManualMatches: boolean) => void;
  areParametersValid: boolean;
}

const AlignmentJobContext = createContext<AlignmentJobContextType | undefined>(undefined);

export const AlignmentJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedTask, setSelectedTask] = useState<AlignmentTask | null>(null);
  const [selectedJobType, setSelectedJobType] = useState<APIJobType | null>(null);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [shouldUseManualMatches, setShouldUseManualMatches] = useState(false);
  const dispatch = useDispatch();

  const dataset = useWkSelector((state) => state.dataset);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const colorLayers = getColorLayers(dataset);
  const colorLayer = colorLayers[0];

  const selectedBoundingBox = getBoundingBoxesForLayers([colorLayer])[0];

  useEffect(() => {
    if (dataset && selectedTask) {
      setNewDatasetName(`${dataset.name}_${selectedTask.name?.replace(/\s/g, "_")}`);
    }
  }, [dataset, selectedTask]);

  const areParametersValid = useMemo(
    () => Boolean(selectedTask && selectedJobType && newDatasetName),
    [selectedTask, selectedJobType, newDatasetName],
  );

  const handleStartAnalysis = useCallback(async () => {
    try {
      startAlignSectionsJob(
        dataset.id,
        colorLayer.name,
        newDatasetName,
        shouldUseManualMatches ? annotationId : undefined,
      );
      Toast.success("Alignment started successfully!");
      dispatch(setAIJobDrawerStateAction("invisible"));
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start alignment.");
    }
  }, [dataset.id, dispatch, colorLayer.name, newDatasetName, annotationId, shouldUseManualMatches]);

  const value = {
    selectedJobType,
    selectedTask,
    selectedBoundingBox,
    newDatasetName,
    setSelectedJobType,
    setNewDatasetName,
    setSelectedTask,
    handleStartAnalysis,
    shouldUseManualMatches,
    setShouldUseManualMatches,
    areParametersValid,
  };

  return <AlignmentJobContext.Provider value={value}>{children}</AlignmentJobContext.Provider>;
};

export const useAlignmentJobContext = () => {
  const context = useContext(AlignmentJobContext);
  if (context === undefined) {
    throw new Error("useAlignmentJobContext must be used within a AlignmentJobContextProvider");
  }
  return context;
};
