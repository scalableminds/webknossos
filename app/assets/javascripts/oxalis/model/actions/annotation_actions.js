// @flow
/* eslint-disable import/prefer-default-export */
type SetAnnotationNameActionType = {
  type: "SET_ANNOTATION_NAME",
  name: string,
};

type SetAnnotationPubliceActionType = {
  type: "SET_ANNOTATION_PUBLIC",
  isPublic: boolean,
};

export type AnnotationActionTypes = SetAnnotationNameActionType | SetAnnotationPubliceActionType;

export const setAnnotationNameAction = (name: string): SetAnnotationNameActionType => ({
  type: "SET_ANNOTATION_NAME",
  name,
});

export const setAnnotationPublicAction = (isPublic: boolean): SetAnnotationPubliceActionType => ({
  type: "SET_ANNOTATION_PUBLIC",
  isPublic,
});
