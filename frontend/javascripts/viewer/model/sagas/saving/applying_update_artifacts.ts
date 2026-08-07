import type { PreservedMeshDisplayProps } from "../volume/proofreading/segment_and_mesh_refresh_sagas";

/*
 * This module holds the "artifacts" that applying foreign missing update actions produces, i.e. the information
 * that is needed *after* the update actions were applied (see tryToIncorporateActions in
 * incorporate_update_actions_sagas.ts). The artifacts are passed up the saga calling hierarchy so
 * that side effects (e.g. reloading the newest auxiliary agglomerate meshes) can be triggered once
 * the applying/saving is done (see mesh_artifact_resolution_sagas.ts).
 */

export type ApplyingUpdateArtifacts = {
  // All properties having the layer name / tracing id as a key.
  meshIdsToRemovePerLayer: ReadonlyMap<string, ReadonlySet<number>>;
  // Maps for each layer from agglomerate ids whose meshes should be (re)loaded to the display
  // properties (opacity and visibility) the reloaded mesh should inherit from the agglomerate it
  // originated from (empty if nothing was stored for the original mesh).
  meshesToLoadPerLayer: ReadonlyMap<string, ReadonlyMap<number, PreservedMeshDisplayProps>>;
};

export type ApplyingUpdateResults = { success: boolean; artifactInfos: ApplyingUpdateArtifacts };

export const FailedIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: false,
  artifactInfos: {
    meshIdsToRemovePerLayer: new Map(),
    meshesToLoadPerLayer: new Map(),
  },
};
export const SuccessEmptyIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: true,
  artifactInfos: {
    meshIdsToRemovePerLayer: new Map(),
    meshesToLoadPerLayer: new Map(),
  },
};
