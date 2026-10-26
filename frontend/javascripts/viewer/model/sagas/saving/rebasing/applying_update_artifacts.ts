import type { PreservedMeshDisplayProps } from "../../volume/proofreading/segment_and_mesh_refresh_sagas";

/*
 * This module holds the "artifacts" that applying foreign missing update actions produces, i.e. the information
 * that is needed *after* the update actions were applied (see tryToIncorporateActions in
 * incorporate_update_actions_sagas.ts). The artifacts are passed up the saga calling hierarchy so
 * that side effects (e.g. reloading the newest auxiliary agglomerate meshes) can be triggered once
 * the applying/saving is done (see mesh_artifact_resolution_sagas.ts).
 */

export type ApplyingUpdateArtifacts = {
  // All properties having the layer name / tracing id as a key.
  meshIdsToRemovePerLayer: ReadonlyMap<string, ReadonlySet<bigint>>;
  // Maps for each layer to agglomerate ids whose meshes should be (re)loaded. In the inner map
  // the agglomerate ids map to the display properties (opacity and visibility). This info is
  // necessary because the display properties of reloaded meshes should inherit stay the same as before.
  meshesToLoadPerLayer: ReadonlyMap<string, ReadonlyMap<bigint, PreservedMeshDisplayProps>>;
};

// Describes why applying update actions (and thus rebasing) failed. It is reported to Airbrake
// by the version polling saga (see version_poll_saga.ts).
export type RebasingFailure = {
  // A stable description without ids so that Airbrake groups the reports.
  reason: string;
  // Expected failures (e.g., another user reverted the annotation) are reported as warnings.
  isExpected?: boolean;
  error?: unknown;
  details?: Record<string, unknown>;
};

export type ApplyingUpdateResults = {
  success: boolean;
  artifactInfos: ApplyingUpdateArtifacts;
  // Only set if success is false.
  failure?: RebasingFailure;
};

export const FailedIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: false,
  artifactInfos: {
    meshIdsToRemovePerLayer: new Map(),
    meshesToLoadPerLayer: new Map(),
  },
};
export function getFailedIncorporateActionsReturnValue(
  failure: RebasingFailure,
): ApplyingUpdateResults {
  return { ...FailedIncorporateActionsReturnValue, failure };
}

export const SuccessEmptyIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: true,
  artifactInfos: {
    meshIdsToRemovePerLayer: new Map(),
    meshesToLoadPerLayer: new Map(),
  },
};
