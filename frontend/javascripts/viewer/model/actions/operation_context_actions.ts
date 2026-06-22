// Named operations currently used in the app. Child operations (registered via borrowedContext)
// can use any id, but top-level operations should use one of these known IDs to maintain clarity.
export type OperationId =
  | "PROOFREADING"
  | "MIN_CUT"
  | "FLOODFILL"
  | "QUICK_SELECT"
  | "INTERPOLATE_SEGMENTATION_LAYER"
  | "DELETE_SEGMENT"
  | "UNDO"
  | "REDO"
  | "SAVE"
  | "REBASE";

export const SYNC_RELATED_OPERATION_IDS: OperationId[] = ["SAVE", "REBASE"];

export type RegisterOperationAction = {
  type: "REGISTER_OPERATION";
  id: OperationId;
  description?: string;
};
export type UnregisterOperationAction = {
  type: "UNREGISTER_OPERATION";
  id: OperationId;
};
export type RegisterChildOperationAction = {
  type: "REGISTER_CHILD_OPERATION";
  id: OperationId;
  parentId: OperationId;
};
export type UnregisterChildOperationAction = {
  type: "UNREGISTER_CHILD_OPERATION";
  id: OperationId;
  parentId: OperationId;
};

export type OperationContextAction =
  | RegisterOperationAction
  | UnregisterOperationAction
  | RegisterChildOperationAction
  | UnregisterChildOperationAction;

export const registerOperationAction = (
  id: OperationId,
  description?: string,
): RegisterOperationAction => ({
  type: "REGISTER_OPERATION",
  id,
  description,
});

export const unregisterOperationAction = (id: OperationId): UnregisterOperationAction => ({
  type: "UNREGISTER_OPERATION",
  id,
});

export const registerChildOperationAction = (
  id: OperationId,
  parentId: OperationId,
): RegisterChildOperationAction => ({
  type: "REGISTER_CHILD_OPERATION",
  id,
  parentId,
});

export const unregisterChildOperationAction = (
  id: OperationId,
  parentId: OperationId,
): UnregisterChildOperationAction => ({
  type: "UNREGISTER_CHILD_OPERATION",
  id,
  parentId,
});
