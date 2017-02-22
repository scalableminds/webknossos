/* eslint-disable import/prefer-default-export */

/**
 * skeletontracing_actions.js
 * @flow
 */
import type { Tracing } from "oxalis/model";

type initializeSkeletonTracingActionType = {type: "INITIALIZE_SKELETONTRACING", tracing: Tracing };

export type SkeletonTracingActionTypes = initializeSkeletonTracingActionType;

export const initializeSkeletonTracingAction = (tracing: Tracing) => ({
  type: "INITIALIZE_SKELETONTRACING",
  tracing,
});

