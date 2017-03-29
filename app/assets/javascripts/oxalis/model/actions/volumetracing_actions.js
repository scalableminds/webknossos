// @flow
import type { Tracing } from "oxalis/model";
import type { VolumeContentDataType } from "oxalis/store";

type InitializeVolumeTracingActionType = { type: "INITIALIZE_VOLUMETRACING", tracing: Tracing<VolumeContentDataType> };
type CreateCellActionType = { type: "CREATE_CELL" };
type StartEditingActionType = { type: "START_EDITING" };
type FinishEditingActionType = { type: "FINISH_EDITING" };
type AddToLayerActionType = { type: "ADD_TO_LAYER", position: Vector3 };
type SetActiveCellActionType = { type: "SET_ACTIVE_CELL", activeCellId: number };

export type VolumeTracingActionType =
  | InitializeVolumeTracingActionType
  | CreateCellActionType
  | StartEditingActionType
  | FinishEditingActionType
  | AddToLayerActionType
  | SetActiveCellActionType;

export const initializeVolumeTracingAction = (tracing: Tracing<VolumeContentDataType>): InitializeVolumeTracingActionType => ({
  type: "INITIALIZE_VOLUMETRACING",
  tracing,
});
