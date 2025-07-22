import * as Utils from "libs/utils";
import type {
  APIAnnotation,
  AdditionalAxis,
  AdditionalAxisProto,
  BoundingBoxProto,
  SkeletonUserState,
  UserBoundingBoxProto,
  VolumeUserState,
} from "types/api_types";
import type { BoundingBoxMinMaxType } from "types/bounding_box";
import type { Vector3 } from "viewer/constants";
import type { AnnotationTool, AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Toolkits } from "viewer/model/accessors/tool_accessor";
import { updateKey } from "viewer/model/helpers/deep_update";
import type {
  Annotation,
  BoundingBoxObject,
  SegmentGroup,
  UserBoundingBox,
  UserBoundingBoxForServer,
  UserBoundingBoxWithOptIsVisible,
  WebknossosState,
} from "viewer/store";
import { type DisabledInfo, getDisabledInfoForTools } from "../accessors/disabled_tool_accessor";
import type { UpdateUserBoundingBoxInSkeletonTracingAction } from "../sagas/volume/update_actions";
import type { Tree, TreeGroup } from "../types/tree_types";

function convertServerBoundingBoxToBoundingBoxMinMaxType(
  boundingBox: BoundingBoxProto,
): BoundingBoxMinMaxType {
  const min = Utils.point3ToVector3(boundingBox.topLeft);
  const max: Vector3 = [
    min[0] + boundingBox.width,
    min[1] + boundingBox.height,
    min[2] + boundingBox.depth,
  ];
  return { min, max };
}

export function convertServerBoundingBoxToFrontend(
  boundingBox: BoundingBoxProto | null | undefined,
): BoundingBoxMinMaxType | null | undefined {
  if (!boundingBox) return boundingBox;
  return convertServerBoundingBoxToBoundingBoxMinMaxType(boundingBox);
}

export function convertUserBoundingBoxFromUpdateActionToFrontend(
  bboxValue: UpdateUserBoundingBoxInSkeletonTracingAction["value"],
): Partial<UserBoundingBox> {
  const {
    boundingBox,
    boundingBoxId: _boundingBoxId,
    actionTracingId: _actionTracingId,
    ...valueWithoutBoundingBox
  } = bboxValue;
  const maybeBoundingBoxValue =
    boundingBox != null
      ? { boundingBox: Utils.computeBoundingBoxFromBoundingBoxObject(boundingBox) }
      : {};

  return {
    ...valueWithoutBoundingBox,
    ...maybeBoundingBoxValue,
  };
}

export function convertUserBoundingBoxesFromServerToFrontend(
  boundingBoxes: Array<UserBoundingBoxProto>,
  userState: SkeletonUserState | VolumeUserState | undefined,
): Array<UserBoundingBox> {
  const idToVisible = userState ? Utils.mapEntriesToMap(userState.boundingBoxVisibilities) : {};

  return boundingBoxes.map((bb) => {
    const { color, id, name, isVisible, boundingBox } = bb;
    const convertedBoundingBox = convertServerBoundingBoxToBoundingBoxMinMaxType(boundingBox);
    return {
      boundingBox: convertedBoundingBox,
      color: color ? Utils.colorObjectToRGBArray(color) : Utils.getRandomColor(),
      id,
      name: name || `Bounding box ${id}`,
      isVisible: idToVisible[id] ?? isVisible ?? true,
    };
  });
}

export function convertUserBoundingBoxFromFrontendToServer(
  boundingBox: UserBoundingBoxWithOptIsVisible,
): UserBoundingBoxForServer {
  const { boundingBox: bb, ...rest } = boundingBox;
  return { ...rest, boundingBox: Utils.computeBoundingBoxObjectFromBoundingBox(bb) };
}

export function convertFrontendBoundingBoxToServer(
  boundingBox: BoundingBoxMinMaxType,
): BoundingBoxObject {
  return {
    topLeft: boundingBox.min,
    width: boundingBox.max[0] - boundingBox.min[0],
    height: boundingBox.max[1] - boundingBox.min[1],
    depth: boundingBox.max[2] - boundingBox.min[2],
  };
}

export function convertBoundingBoxProtoToObject(boundingBox: BoundingBoxProto): BoundingBoxObject {
  return {
    width: boundingBox.width,
    height: boundingBox.height,
    depth: boundingBox.depth,
    topLeft: Utils.point3ToVector3(boundingBox.topLeft),
  };
}

export function convertServerAnnotationToFrontendAnnotation(
  annotation: APIAnnotation,
  version: number,
  earliestAccessibleVersion: number,
): Annotation {
  const {
    id: annotationId,
    visibility,
    tags,
    description,
    name,
    typ: annotationType,
    tracingStore,
    stats,
    owner,
    contributors,
    organization,
    othersMayEdit,
    isLockedByOwner,
    annotationLayers,
  } = annotation;
  const restrictions = {
    ...annotation.restrictions,
    ...annotation.settings,
  };
  return {
    annotationId,
    restrictions,
    visibility,
    tags,
    version,
    earliestAccessibleVersion,
    stats,
    description,
    name,
    annotationType,
    organization,
    isLockedByOwner,
    tracingStore,
    owner,
    contributors,
    othersMayEdit,
    annotationLayers,
    blockedByUser: null,
    isMutexAcquired: false,
  };
}

export function convertServerAdditionalAxesToFrontEnd(
  additionalAxes: AdditionalAxisProto[],
): AdditionalAxis[] {
  return additionalAxes.map((coords) => ({
    ...coords,
    bounds: [coords.bounds.x, coords.bounds.y],
  }));
}

export function isToolAvailable(
  state: WebknossosState,
  disabledToolInfo: Record<AnnotationToolId, DisabledInfo>,
  tool: AnnotationTool,
) {
  const { isDisabled } = disabledToolInfo[tool.id];
  if (isDisabled) {
    return false;
  }
  if (!state.annotation.restrictions.allowUpdate) {
    return Toolkits.READ_ONLY_TOOLS.includes(tool);
  }
  return true;
}

export function getNextTool(state: WebknossosState): AnnotationTool | null {
  const disabledToolInfo = getDisabledInfoForTools(state);
  const tools = Toolkits[state.userConfiguration.activeToolkit];
  const currentToolIndex = tools.indexOf(state.uiInformation.activeTool);

  // Search for the next tool which is not disabled.
  for (
    let newToolIndex = currentToolIndex + 1;
    newToolIndex < currentToolIndex + tools.length;
    newToolIndex++
  ) {
    const newTool = tools[newToolIndex % tools.length];

    if (isToolAvailable(state, disabledToolInfo, newTool)) {
      return newTool;
    }
  }

  return null;
}

export function getPreviousTool(state: WebknossosState): AnnotationTool | null {
  const disabledToolInfo = getDisabledInfoForTools(state);
  const tools = Toolkits[state.userConfiguration.activeToolkit];
  const currentToolIndex = tools.indexOf(state.uiInformation.activeTool);

  // Search backwards for the next tool which is not disabled.
  for (
    let newToolIndex = currentToolIndex - 1;
    newToolIndex > currentToolIndex - tools.length;
    newToolIndex--
  ) {
    const newTool = tools[(tools.length + newToolIndex) % tools.length];

    if (isToolAvailable(state, disabledToolInfo, newTool)) {
      return newTool;
    }
  }

  return null;
}

export function setToolReducer(state: WebknossosState, tool: AnnotationTool) {
  if (tool === state.uiInformation.activeTool) {
    return state;
  }

  const disabledToolInfo = getDisabledInfoForTools(state);
  if (!isToolAvailable(state, disabledToolInfo, tool)) {
    console.log(`Cannot switch to ${tool.readableName} because it's not available.`);
    return state;
  }

  return updateKey(state, "uiInformation", {
    activeTool: tool,
  });
}

export function applyUserStateToGroups<Group extends TreeGroup | SegmentGroup>(
  groups: Group[],
  userState: SkeletonUserState | VolumeUserState | undefined,
): Group[] {
  if (userState == null) {
    return groups;
  }

  const expandedStates =
    "segmentGroupExpandedStates" in userState
      ? userState.segmentGroupExpandedStates
      : userState.treeGroupExpandedStates;

  const groupIdToExpanded: Record<number, boolean> = Utils.mapEntriesToMap(expandedStates);
  return Utils.mapGroupsDeep(groups, (group: Group, children): Group => {
    return {
      ...group,
      isExpanded: groupIdToExpanded[group.groupId] ?? group.isExpanded,
      children,
    };
  });
}

export function getApplyUserStateToTreeFn(
  userState: SkeletonUserState | undefined,
): ((tree: Tree) => Tree) | undefined {
  if (userState == null) {
    return undefined;
  }

  const visibilities = userState.treeVisibilities;
  const treeIdToExpanded: Record<number, boolean> = Utils.mapEntriesToMap(visibilities);
  return (tree) => {
    return {
      ...tree,
      isVisible: treeIdToExpanded[tree.treeId] ?? tree.isVisible,
    };
  };
}
