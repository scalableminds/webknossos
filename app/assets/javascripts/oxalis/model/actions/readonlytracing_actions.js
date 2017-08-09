// @flow
/* eslint-disable import/prefer-default-export */
import type { ServerSkeletonTracingType, ServerAnnotationType } from "oxalis/model";

type InitializeReadOnlyTracingActionType = {
  type: "INITIALIZE_READONLYTRACING",
  annotation: ServerAnnotationType,
  tracing: ServerSkeletonTracingType,
};

export type ReadOnlyTracingActionType = InitializeReadOnlyTracingActionType;

export const initializeReadOnlyTracingAction = (
  annotation: ServerAnnotationType,
  tracing: ServerSkeletonTracingType,
): InitializeReadOnlyTracingActionType => ({
  type: "INITIALIZE_READONLYTRACING",
  annotation,
  tracing,
});
