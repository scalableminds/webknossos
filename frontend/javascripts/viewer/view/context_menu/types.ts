import type { ItemType } from "antd/es/menu/interface";
import type React from "react";
import type {
  AdditionalCoordinate,
  APIConnectomeFile,
  APIDataLayer,
  APIDataset,
  APIMeshFileInfo,
  VoxelSize,
} from "types/api_types";
import type { OrthoView } from "viewer/constants";
import type { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import type {
  ActiveMappingInfo,
  ContextMenuInfo,
  SegmentMap,
  SkeletonTracing,
  UserBoundingBox,
  VolumeTracing,
} from "viewer/store";

export type ContextMenuContextValue = React.MutableRefObject<HTMLElement | null> | null;

export type Props = {
  contextInfo: ContextMenuInfo;
  additionalCoordinates: AdditionalCoordinate[] | undefined;
  skeletonTracing: SkeletonTracing | null | undefined;
  voxelSize: VoxelSize;
  visibleSegmentationLayer: APIDataLayer | null | undefined;
  dataset: APIDataset;
  currentMeshFile: APIMeshFileInfo | null | undefined;
  currentConnectomeFile: APIConnectomeFile | null | undefined;
  volumeTracing: VolumeTracing | null | undefined;
  activeTool: AnnotationTool;
  useLegacyBindings: boolean;
  userBoundingBoxes: Array<UserBoundingBox>;
  mappingInfo: ActiveMappingInfo;
  allowUpdate: boolean;
  isRotated: boolean;
  segments: SegmentMap | null | undefined;
  maybeUnmappedSegmentId: number | null;
};

export type NodeContextMenuOptionsProps = Props & {
  viewport: OrthoView;
  clickedNodeId: number;
  infoRows: ItemType[];
};

export type NoNodeContextMenuProps = Props & {
  viewport: OrthoView;
  segmentIdAtPosition: number;
  activeTool: AnnotationTool;
  infoRows: ItemType[];
};
