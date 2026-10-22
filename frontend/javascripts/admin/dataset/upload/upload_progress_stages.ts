import type { APIJob } from "types/api_types";
import type { UploadStatus } from "./use_resumable_dataset_upload";

export const STAGES = ["upload", "finalize", "convert", "ready"] as const;
export type Stage = (typeof STAGES)[number];
export type StageStatus = "todo" | "active" | "done" | "skipped" | "error";

// What the dialog shows. Unlike UploadStatus, this includes the server-side conversion.
export type UploadPhase =
  | { kind: "uploading" }
  | { kind: "finalizing" }
  | { kind: "converting" }
  | { kind: "ready" }
  | { kind: "failed"; stage: Stage; message: string };

const PHASE_STAGES: Record<Exclude<UploadPhase["kind"], "failed">, Stage> = {
  uploading: "upload",
  finalizing: "finalize",
  converting: "convert",
  ready: "ready",
};

export function getUploadPhase(
  status: Exclude<UploadStatus, { kind: "idle" }>,
  conversionJob: APIJob | null,
): UploadPhase {
  switch (status.kind) {
    case "uploading":
      return { kind: "uploading" };
    case "finishing":
      return { kind: "finalizing" };
    case "failed":
      return { kind: "failed", stage: status.failedStage, message: status.message };
    case "finished": {
      if (!status.needsConversion || conversionJob?.state === "SUCCESS") return { kind: "ready" };
      if (conversionJob?.state === "FAILURE") {
        const message = conversionJob.errorDetails?.message;
        return {
          kind: "failed",
          stage: "convert",
          message: typeof message === "string" ? message : "The conversion of the dataset failed.",
        };
      }
      if (conversionJob?.state === "CANCELLED") {
        return { kind: "failed", stage: "convert", message: "The conversion was cancelled." };
      }
      return { kind: "converting" };
    }
  }
}

export function getStageStatuses(
  phase: UploadPhase,
  needsConversion: boolean,
): Record<Stage, StageStatus> {
  const currentStage = phase.kind === "failed" ? phase.stage : PHASE_STAGES[phase.kind];
  const currentIndex = STAGES.indexOf(currentStage);
  const getStatus = (stage: Stage, index: number): StageStatus => {
    if (stage === "convert" && !needsConversion) {
      return index < currentIndex ? "skipped" : "todo";
    }
    if (index < currentIndex || phase.kind === "ready") return "done";
    if (index === currentIndex) return phase.kind === "failed" ? "error" : "active";
    return "todo";
  };
  return Object.fromEntries(
    STAGES.map((stage, index) => [stage, getStatus(stage, index)]),
  ) as Record<Stage, StageStatus>;
}
