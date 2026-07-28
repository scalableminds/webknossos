import type { Vector3 } from "viewer/constants";
import type { Saga } from "viewer/model/sagas/effect_generators";
import type { ActiveMappingInfo, Mapping, VolumeTracing } from "viewer/store";

export type Preparation = {
  agglomerateFileMag: Vector3;
  getDataValue: (position: Vector3, overrideMapping?: Mapping | null) => Promise<number>;
  mapSegmentId: (segmentId: number, overrideMapping?: Mapping | null) => number;
  getMappedAndUnmapped: (position: Vector3) => Saga<{ agglomerateId: number; unmappedId: number }>;
  activeMapping: ActiveMappingInfo;
  volumeTracing: VolumeTracing & { mappingName: string };
  annotationVersion: number;
};

export type IdInfo = { agglomerateId: number; unmappedId: number; position: Vector3 };
export type IdInfoOpt = {
  agglomerateId: number;
  unmappedId: number;
  position: Vector3 | undefined;
};
export type IdInfoWithoutPosition = { agglomerateId: number; unmappedId: number };

export type GatheredInfos =
  | {
      type: "PROOFREAD_MERGE";
      infos: [IdInfo, IdInfoOpt];
    }
  | {
      type: "MIN_CUT_AGGLOMERATE";
      infos: [IdInfo, IdInfo];
    };
