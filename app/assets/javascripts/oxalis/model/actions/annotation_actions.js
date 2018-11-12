// @flow
import type { APIAnnotation } from "admin/api_flow_types";
import type { BoundingBoxType } from "oxalis/constants";

type InitializeAnnotation = {
  type: "INITIALIZE_ANNOTATION",
  annotation: APIAnnotation,
};

type SetAnnotationNameAction = {
  type: "SET_ANNOTATION_NAME",
  name: string,
};

type SetAnnotationPubliceAction = {
  type: "SET_ANNOTATION_PUBLIC",
  isPublic: boolean,
};

type SetAnnotationDescriptionAction = {
  type: "SET_ANNOTATION_DESCRIPTION",
  description: string,
};

type SetAnnotationAllowUpdateAction = {
  type: "SET_ANNOTATION_ALLOW_UPDATE",
  allowUpdate: boolean,
};

type SetUserBoundingBox = {
  type: "SET_USER_BOUNDING_BOX",
  userBoundingBox: ?BoundingBoxType,
};

export type AnnotationActionTypes =
  | InitializeAnnotation
  | SetAnnotationNameAction
  | SetAnnotationPubliceAction
  | SetAnnotationDescriptionAction
  | SetAnnotationAllowUpdateAction
  | SetUserBoundingBox;

export const initializeAnnotationAction = (annotation: APIAnnotation): InitializeAnnotation => ({
  type: "INITIALIZE_ANNOTATION",
  annotation,
});

export const setAnnotationNameAction = (name: string): SetAnnotationNameAction => ({
  type: "SET_ANNOTATION_NAME",
  name,
});

export const setAnnotationPublicAction = (isPublic: boolean): SetAnnotationPubliceAction => ({
  type: "SET_ANNOTATION_PUBLIC",
  isPublic,
});

export const setAnnotationDescriptionAction = (
  description: string,
): SetAnnotationDescriptionAction => ({
  type: "SET_ANNOTATION_DESCRIPTION",
  description,
});

export const setAnnotationAllowUpdateAction = (
  allowUpdate: boolean,
): SetAnnotationAllowUpdateAction => ({
  type: "SET_ANNOTATION_ALLOW_UPDATE",
  allowUpdate,
});

// Strictly speaking this is no annotation action but a tracing action, as the boundingBox is saved with
// the tracing, hence no ANNOTATION in the action type.
export const setUserBoundingBoxAction = (
  userBoundingBox: ?BoundingBoxType,
): SetUserBoundingBox => ({
  type: "SET_USER_BOUNDING_BOX",
  userBoundingBox,
});
