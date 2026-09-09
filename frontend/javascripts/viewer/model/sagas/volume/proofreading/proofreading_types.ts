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

// A single old-agglomerate-id -> new-agglomerate-id change that a proofreading action (or
// incorporating a foreign one) produces, used throughout segment_and_mesh_refresh_sagas.ts and
// local_mesh_change_sagas.ts to drive segment-item bookkeeping and mesh refreshing.
export type AgglomerateChangeItem = {
  oldAgglomerateId?: bigint;
  newAgglomerateId: bigint;
  nodePosition: Vector3;
  // Opacity and visibility to apply to the reloaded mesh. If unset, the values of the old
  // mesh (oldAgglomerateId) are used before its removal (see reloadMeshes in
  // segment_and_mesh_refresh_sagas.ts).
  opacity?: number;
  isVisible?: boolean;
};

// Display properties of a mesh that should survive a reload.
export type PreservedMeshDisplayProps = {
  opacity?: number;
  isVisible?: boolean;
};
