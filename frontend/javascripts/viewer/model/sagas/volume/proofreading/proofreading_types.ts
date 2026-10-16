import type { Vector3 } from "viewer/constants";
import type { Saga } from "viewer/model/sagas/effect_generators";
import type { ActiveMappingInfo, Mapping, VolumeTracing } from "viewer/store";

export type Preparation = {
  agglomerateFileMag: Vector3;
  getDataValue: (position: Vector3, overrideMapping?: Mapping | null) => Promise<bigint>;
  mapSegmentId: (segmentId: bigint, overrideMapping?: Mapping | null) => bigint;
  getMappedAndUnmapped: (position: Vector3) => Saga<{ agglomerateId: bigint; unmappedId: bigint }>;
  activeMapping: ActiveMappingInfo;
  volumeTracing: VolumeTracing & { mappingName: string };
  annotationVersion: number;
};

export type IdInfo = { agglomerateId: bigint; unmappedId: bigint; position: Vector3 };
export type IdInfoOpt = {
  agglomerateId: bigint;
  unmappedId: bigint;
  position: Vector3 | undefined;
};
export type IdInfoWithoutPosition = { agglomerateId: bigint; unmappedId: bigint };

export type GatheredInfos =
  | {
      type: "PROOFREAD_MERGE";
      infos: [IdInfo, IdInfoOpt];
    }
  | {
      type: "MIN_CUT_AGGLOMERATE";
      infos: [IdInfo, IdInfo];
    };

// Display properties of a mesh that should survive a reload.
export type PreservedMeshDisplayProps = {
  opacity?: number;
  isVisible?: boolean;
};

// A single old-agglomerate-id -> new-agglomerate-id change that a proofreading action (or
// incorporating a foreign one) produces. segment_and_mesh_refresh_sagas.ts uses it to update the
// segment items and to refresh the affected meshes.
// Opacity and visibility to apply to the reloaded mesh. The callers take them from the old mesh
// before it is removed: refreshProofreadingSegmentsAndMeshes for the user's own proofreading
// actions and incorporate_update_actions_sagas.tsx for foreign ones.
export type AgglomerateChangeItem = {
  oldAgglomerateId?: bigint;
  newAgglomerateId: bigint;
  nodePosition: Vector3;
} & PreservedMeshDisplayProps;
