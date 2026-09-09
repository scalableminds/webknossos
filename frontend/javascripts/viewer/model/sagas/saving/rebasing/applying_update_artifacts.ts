import type { PreservedMeshDisplayProps } from "../../volume/proofreading/proofreading_types";

/*
 * This module holds the "artifacts" that applying foreign missing update actions produces, i.e. the information
 * that is needed *after* the update actions were applied (see tryToIncorporateActions in
 * incorporate_update_actions_sagas.ts). The artifacts are passed up the saga calling hierarchy so
 * that side effects (e.g. reloading the newest auxiliary agglomerate meshes) can be triggered once
 * the applying/saving is done (see mesh_artifact_resolution_sagas.ts).
 */

// Every agglomerate id that fed into a queued reload's new agglomerate id (a single id for a
// plain split piece, two-or-more for a merge survivor - see recordMeshToLoad in
// incorporate_update_actions_sagas.ts) plus the display properties (opacity/visibility) the
// reloaded/spliced mesh should inherit. Keeping the contributing old ids around (rather than
// just the display props) lets resolveApplyingUpdateArtifacts hand off real
// AgglomerateChangeItem-shaped data to syncAffectedAndLoadMissingMeshes, so foreign
// merges/splits can be spliced locally instead of always doing a hard reload.
export type MeshReloadEntry = {
  oldAgglomerateIds: ReadonlySet<bigint>;
  displayProps: PreservedMeshDisplayProps;
};

export type ApplyingUpdateArtifacts = {
  // Maps each layer / tracing id to the agglomerate ids whose meshes should be (re)loaded, and
  // for each, which old agglomerate id(s) it came from.
  meshesToLoadPerLayer: ReadonlyMap<string, ReadonlyMap<bigint, MeshReloadEntry>>;
};

export type ApplyingUpdateResults = {
  success: boolean;
  artifactInfos: ApplyingUpdateArtifacts;
};

export const FailedIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: false,
  artifactInfos: {
    meshesToLoadPerLayer: new Map(),
  },
};
export const SuccessEmptyIncorporateActionsReturnValue: ApplyingUpdateResults = {
  success: true,
  artifactInfos: {
    meshesToLoadPerLayer: new Map(),
  },
};
