// @flow
/* eslint-disable import/prefer-default-export */
import type { ServerTracing, SkeletonContentDataType } from "oxalis/model";

type InitializeReadOnlyTracingActionType = { type: "INITIALIZE_READONLYTRACING", tracing: ServerTracing<SkeletonContentDataType> };

export type ReadOnlyTracingActionType =
  | InitializeReadOnlyTracingActionType;

export const initializeReadOnlyTracingAction = (tracing: ServerTracing<SkeletonContentDataType>): InitializeReadOnlyTracingActionType => ({
  type: "INITIALIZE_READONLYTRACING",
  tracing,
});
