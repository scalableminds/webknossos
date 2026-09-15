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
