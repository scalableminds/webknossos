// @flow
import type { Tracing, SkeletonContentDataType } from "oxalis/model";

type InitializeReadOnlyTracingActionType = { type: "INITIALIZE_READONLYTRACING", tracing: Tracing<SkeletonContentDataType> };

export type ReadOnlyTracingActionType =
  | InitializeReadOnlyTracingActionType;

export const initializeReadOnlyTracingAction = (tracing: Tracing<SkeletonContentDataType>): InitializeReadOnlyTracingActionType => ({
  type: "INITIALIZE_READONLYTRACING",
  tracing,
});
