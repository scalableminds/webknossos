import { refreshOrganizationCredits, startAlignSectionsJob } from "admin/rest_api";
import type { KeyValuePairs } from "components/key_value_pairs";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { APIDataLayer } from "types/api_types";
import { getColorLayers } from "viewer/model/accessors/dataset_accessor";
import type { UserBoundingBox } from "viewer/store";
import { getBoundingBoxesForLayers } from "viewer/view/ai_jobs/utils";
import {
  collectRequirements,
  EMPTY_FORM_VALIDATION_STATE,
  type FormValidationState,
  isFormValid,
  type JobRequirement,
  type StepStatus,
} from "../components/job_requirements";
import type { StartedJob } from "../components/job_started_card";
import type { AlignmentTask } from "./ai_alignment_model_selector";

// Maximum jump size (in voxels) that fine alignment is assumed to have to bridge. This defines the
// contract of what "fine alignment only" means and is intentionally not exposed in the UI for now.
export const FINE_ALIGNMENT_MAX_JUMP_SIZE = 500;

interface AlignmentJobContextType {
  handleStartAnalysis: () => Promise<void>;
  newDatasetName: string;
  selectedTask: AlignmentTask | null;
  setSelectedTask: (task: AlignmentTask) => void;
  selectedBoundingBox: UserBoundingBox | null;
  colorLayer: APIDataLayer;
  setNewDatasetName: (name: string) => void;
  shouldUseManualMatches: boolean;
  setShouldUseManualMatches: (shouldUseManualMatches: boolean) => void;
  customConfiguration: KeyValuePairs;
  setCustomConfiguration: (config: KeyValuePairs) => void;
  setSettingsFormState: (state: FormValidationState) => void;
  fineAlignmentOnly: boolean;
  setFineAlignmentOnly: (fineAlignmentOnly: boolean) => void;
  areParametersValid: boolean;
  requirements: JobRequirement[];
  stepStatuses: { task: StepStatus; settings: StepStatus };
  startedJob: StartedJob | null;
}

const AlignmentJobContext = createContext<AlignmentJobContextType | undefined>(undefined);

export const AlignmentJobContextProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [selectedTask, setSelectedTask] = useState<AlignmentTask | null>(null);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [shouldUseManualMatches, setShouldUseManualMatches] = useState(false);
  const [customConfiguration, setCustomConfiguration] = useState<KeyValuePairs>({});
  const [settingsFormState, setSettingsFormState] = useState(EMPTY_FORM_VALIDATION_STATE);
  const [fineAlignmentOnly, setFineAlignmentOnly] = useState(false);
  const [startedJob, setStartedJob] = useState<StartedJob | null>(null);

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

  // Auto-update the organization credit's information once an AlignmentJobContext is created to
  // ensure most recent information about the organizations credits is displayed during alignment job selection.
  useEffect(() => {
    refreshOrganizationCredits();
  }, []);

  const requirements = useMemo(
    () =>
      collectRequirements(
        [
          { label: "Select an alignment task", isMissing: !selectedTask?.jobType },
          {
            label: "Enter a new dataset name",
            isMissing: !newDatasetName,
            field: "newDatasetName",
          },
        ],
        settingsFormState,
      ),
    [selectedTask, newDatasetName, settingsFormState],
  );

  const areParametersValid = requirements.length === 0;
  const stepStatuses = {
    task: selectedTask ? "done" : "pending",
    settings: newDatasetName && isFormValid(settingsFormState) ? "done" : "pending",
  } as const;

  const handleStartAnalysis = useCallback(async () => {
    const manualMatchesAnnotationId = shouldUseManualMatches ? annotationId : undefined;
    const maxJumpSize = fineAlignmentOnly ? FINE_ALIGNMENT_MAX_JUMP_SIZE : undefined;

    try {
      await startAlignSectionsJob(
        dataset.id,
        colorLayer.name,
        newDatasetName,
        manualMatchesAnnotationId,
        customConfiguration,
        maxJumpSize,
      );
      setStartedJob({
        title: "Section alignment is running.",
        description: `The aligned images go to the new dataset "${newDatasetName}". You will receive an email when the job finishes.`,
      });
    } catch (error) {
      console.error(error);
      Toast.error("Failed to start alignment.");
    }
  }, [
    dataset.id,
    colorLayer.name,
    newDatasetName,
    annotationId,
    shouldUseManualMatches,
    customConfiguration,
    fineAlignmentOnly,
    setStartedJob,
  ]);

  const value = {
    selectedTask,
    selectedBoundingBox,
    colorLayer,
    newDatasetName,
    setNewDatasetName,
    setSelectedTask,
    handleStartAnalysis,
    shouldUseManualMatches,
    setShouldUseManualMatches,
    customConfiguration,
    setCustomConfiguration,
    setSettingsFormState,
    fineAlignmentOnly,
    setFineAlignmentOnly,
    areParametersValid,
    requirements,
    stepStatuses,
    startedJob,
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
