// @flow
import type { BoundingBoxType } from "oxalis/constants";
import type { APIAnnotationType } from "admin/api_flow_types";

type InitializeAnnotationType = {
  type: "INITIALIZE_ANNOTATION",
  annotation: APIAnnotationType,
};

type SetAnnotationNameActionType = {
  type: "SET_ANNOTATION_NAME",
  name: string,
};

type SetAnnotationPubliceActionType = {
  type: "SET_ANNOTATION_PUBLIC",
  isPublic: boolean,
};

type SetAnnotationDescriptionActionType = {
  type: "SET_ANNOTATION_DESCRIPTION",
  description: string,
};

type SetUserBoundingBoxType = {
  type: "SET_USER_BOUNDING_BOX",
  userBoundingBox: ?BoundingBoxType,
};

export type AnnotationActionTypes =
  | InitializeAnnotationType
  | SetAnnotationNameActionType
  | SetAnnotationPubliceActionType
  | SetAnnotationDescriptionActionType
  | SetUserBoundingBoxType;

export const initializeAnnotationAction = (
  annotation: APIAnnotationType,
): InitializeAnnotationType => ({
  type: "INITIALIZE_ANNOTATION",
  annotation,
});

export const setAnnotationNameAction = (name: string): SetAnnotationNameActionType => ({
  type: "SET_ANNOTATION_NAME",
  name,
});

export const setAnnotationPublicAction = (isPublic: boolean): SetAnnotationPubliceActionType => ({
  type: "SET_ANNOTATION_PUBLIC",
  isPublic,
});

export const setAnnotationDescriptionAction = (
  description: string,
): SetAnnotationDescriptionActionType => ({
  type: "SET_ANNOTATION_DESCRIPTION",
  description,
});

// Strictly speaking this is no annotation action but a tracing action, as the boundingBox is saved with
// the tracing, hence no ANNOTATION in the action type.
export const setUserBoundingBoxAction = (
  userBoundingBox: ?BoundingBoxType,
): SetUserBoundingBoxType => ({
  type: "SET_USER_BOUNDING_BOX",
  userBoundingBox,
});
