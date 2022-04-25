import Maybe from "data.maybe";
import { updateKey } from "oxalis/model/helpers/deep_update";
import type {
  APIAnnotation,
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
import type { Boundary } from "oxalis/model/accessors/dataset_accessor";
import { AnnotationToolEnum } from "oxalis/constants";
import type { BoundingBoxType, AnnotationTool } from "oxalis/constants";
import { V3 } from "libs/mjs";
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
  // The exact spreading is needed for flow to grasp that the conversion is correct.
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
export function convertBoundariesToBoundingBox(boundary: Boundary): BoundingBoxObject {
  const [width, height, depth] = V3.sub(boundary.upperBoundary, boundary.lowerBoundary);
  return {
    width,
    height,
    depth,
    topLeft: boundary.lowerBoundary,
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
    meshes,
    user,
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
    tracingStore,
    meshes,
    user,
    annotationLayers,
  };
}
export function getNextTool(state: OxalisState): AnnotationTool | null {
  const disabledToolInfo = getDisabledInfoForTools(state);
  const tools = Object.keys(AnnotationToolEnum);
  const currentToolIndex = tools.indexOf(state.uiInformation.activeTool);

  // Search for the next tool which is not disabled.
  for (
    let newToolIndex = currentToolIndex + 1;
    newToolIndex < currentToolIndex + tools.length;
    newToolIndex++
  ) {
    const newTool = tools[newToolIndex % tools.length];

    // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (!disabledToolInfo[newTool].isDisabled) {
      // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type '"TRACE" |... Remove this comment to see the full error message
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
