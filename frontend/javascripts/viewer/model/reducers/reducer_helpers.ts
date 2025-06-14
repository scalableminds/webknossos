import * as Utils from "libs/utils";
import type {
  APIAnnotation,
  AdditionalAxis,
  ServerAdditionalAxis,
  ServerBoundingBox,
  UserBoundingBoxFromServer,
} from "types/api_types";
import type { BoundingBoxType } from "viewer/constants";
import type { AnnotationTool, AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Toolkits } from "viewer/model/accessors/tool_accessor";
import { updateKey } from "viewer/model/helpers/deep_update";
import type { BoundingBoxObject, UserBoundingBox, UserBoundingBoxToServer } from "viewer/store";
import type { Annotation, WebknossosState } from "viewer/store";
import { type DisabledInfo, getDisabledInfoForTools } from "../accessors/disabled_tool_accessor";

export function convertServerBoundingBoxToBoundingBox(
  boundingBox: ServerBoundingBox,
): BoundingBoxType {
  return Utils.computeBoundingBoxFromArray(
    Utils.concatVector3(Utils.point3ToVector3(boundingBox.topLeft), [
      boundingBox.width,
      boundingBox.height,
      boundingBox.depth,
    ]),
  );
}
export function convertServerBoundingBoxToFrontend(
  boundingBox: ServerBoundingBox | null | undefined,
): BoundingBoxType | null | undefined {
  if (!boundingBox) return null;
  return convertServerBoundingBoxToBoundingBox(boundingBox);
}
export function convertUserBoundingBoxesFromServerToFrontend(
  boundingBoxes: Array<UserBoundingBoxFromServer>,
): Array<UserBoundingBox> {
  return boundingBoxes.map((bb) => {
    const { color, id, name, isVisible, boundingBox } = bb;
    const convertedBoundingBox = convertServerBoundingBoxToBoundingBox(boundingBox);
    return {
      boundingBox: convertedBoundingBox,
      color: color ? Utils.colorObjectToRGBArray(color) : Utils.getRandomColor(),
      id,
      name: name || `Bounding box ${id}`,
      isVisible: isVisible != null ? isVisible : true,
    };
  });
}

export function convertUserBoundingBoxFromFrontendToServer(
  boundingBox: UserBoundingBox,
): UserBoundingBoxToServer {
  const { boundingBox: bb, ...rest } = boundingBox;
  return { ...rest, boundingBox: Utils.computeBoundingBoxObjectFromBoundingBox(bb) };
}
export function convertFrontendBoundingBoxToServer(
  boundingBox: BoundingBoxType,
): BoundingBoxObject {
  return {
    topLeft: boundingBox.min,
    width: boundingBox.max[0] - boundingBox.min[0],
    height: boundingBox.max[1] - boundingBox.min[1],
    depth: boundingBox.max[2] - boundingBox.min[2],
  };
}

export function convertPointToVecInBoundingBox(boundingBox: ServerBoundingBox): BoundingBoxObject {
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
    initialAllowUpdate: annotation.restrictions.allowUpdate,
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
  };
}

export function convertServerAdditionalAxesToFrontEnd(
  additionalAxes: ServerAdditionalAxis[],
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
    return state;
  }

  return updateKey(state, "uiInformation", {
    activeTool: tool,
  });
}
