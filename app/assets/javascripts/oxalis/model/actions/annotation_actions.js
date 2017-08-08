// @flow
/* eslint-disable import/prefer-default-export */
type SetTracingNameActionType = {
  type: "SET_TRACING_NAME",
  name: string,
};

export type AnnotationActionTypes = SetTracingNameActionType;

export const setTracingNameAction = (name: string): SetTracingNameActionType => ({
  type: "SET_TRACING_NAME",
  name,
});
