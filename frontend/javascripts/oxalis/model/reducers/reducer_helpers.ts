import Maybe from "data.maybe";
import { updateKey } from "oxalis/model/helpers/deep_update";
import type {
  AdditionalAxis,
  APIAnnotation,
  ServerAdditionalAxis,
  ServerBoundingBox,
  UserBoundingBoxFromServer,
} from "types/api_flow_types";
import type {
  Annotation,
  BoundingBoxObject,
  UserBoundingBox,
  UserBoundingBoxToServer,
  OxalisState,
} from "oxalis/store";
import { AnnotationToolEnum } from "oxalis/constants";
import type { BoundingBoxType, AnnotationTool } from "oxalis/constants";
import * as Utils from "libs/utils";
import { getDisabledInfoForTools } from "oxalis/model/accessors/tool_accessor";
import {
  isVolumeTool,
  isVolumeAnnotationDisallowedForZoom,
} from "oxalis/model/accessors/volumetracing_accessor";

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
  return Maybe.fromNullable(boundingBox)
    .map((bb) => convertServerBoundingBoxToBoundingBox(bb))
    .getOrElse(null);
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
export function convertUserBoundingBoxesFromFrontendToServer(
  boundingBoxes: Array<UserBoundingBox>,
): Array<UserBoundingBoxToServer> {
  return boundingBoxes.map((bb) => {
    const { boundingBox, ...rest } = bb;
    return { ...rest, boundingBox: Utils.computeBoundingBoxObjectFromBoundingBox(boundingBox) };
  });
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

// Currently unused.
export function convertPointToVecInBoundingBox(boundingBox: ServerBoundingBox): BoundingBoxObject {
  return {
    width: boundingBox.width,
    height: boundingBox.height,
    depth: boundingBox.depth,
    topLeft: Utils.point3ToVector3(boundingBox.topLeft),
  };
}
export function convertServerAnnotationToFrontendAnnotation(annotation: APIAnnotation): Annotation {
  const {
    id: annotationId,
    visibility,
    tags,
    description,
    name,
    typ: annotationType,
    tracingStore,
    owner,
    contributors,
    othersMayEdit,
    isLockedByOwner,
    annotationLayers,
  } = annotation;
  const restrictions = { ...annotation.restrictions, ...annotation.settings };
  return {
    annotationId,
    restrictions,
    visibility,
    tags,
    description,
    name,
    annotationType,
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

export function getNextTool(state: OxalisState): AnnotationTool | null {
  const disabledToolInfo = getDisabledInfoForTools(state);
  const tools = Object.keys(AnnotationToolEnum) as AnnotationTool[];
  const currentToolIndex = tools.indexOf(state.uiInformation.activeTool);

  // Search for the next tool which is not disabled.
  for (
    let newToolIndex = currentToolIndex + 1;
    newToolIndex < currentToolIndex + tools.length;
    newToolIndex++
  ) {
    const newTool = tools[newToolIndex % tools.length];

    if (!disabledToolInfo[newTool].isDisabled) {
      return newTool;
    }
  }

  return null;
}
export function getPreviousTool(state: OxalisState): AnnotationTool | null {
  const disabledToolInfo = getDisabledInfoForTools(state);
  const tools = Object.keys(AnnotationToolEnum) as AnnotationTool[];
  const currentToolIndex = tools.indexOf(state.uiInformation.activeTool);

  // Search backwards for the next tool which is not disabled.
  for (
    let newToolIndex = currentToolIndex - 1;
    newToolIndex > currentToolIndex - tools.length;
    newToolIndex--
  ) {
    const newTool = tools[(tools.length + newToolIndex) % tools.length];

    if (!disabledToolInfo[newTool].isDisabled) {
      return newTool;
    }
  }

  return null;
}
export function setToolReducer(state: OxalisState, tool: AnnotationTool) {
  if (tool === state.uiInformation.activeTool) {
    return state;
  }

  if (isVolumeTool(tool) && isVolumeAnnotationDisallowedForZoom(tool, state)) {
    return state;
  }

  return updateKey(state, "uiInformation", {
    activeTool: tool,
  });
}
