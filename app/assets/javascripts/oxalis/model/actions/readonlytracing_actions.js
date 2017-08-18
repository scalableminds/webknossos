// @flow
/* eslint-disable import/prefer-default-export */
import type { ServerSkeletonTracingType } from "oxalis/model";
import type { APIAnnotationType } from "admin/api_flow_types";

type InitializeReadOnlyTracingActionType = {
  type: "INITIALIZE_READONLYTRACING",
  annotation: APIAnnotationType,
  tracing: ServerSkeletonTracingType,
};

export type ReadOnlyTracingActionType = InitializeReadOnlyTracingActionType;

export const initializeReadOnlyTracingAction = (
  annotation: APIAnnotationType,
  tracing: ServerSkeletonTracingType,
): InitializeReadOnlyTracingActionType => ({
  type: "INITIALIZE_READONLYTRACING",
  annotation,
  tracing,
});
