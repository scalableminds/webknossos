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

export const registerOperationAction = (id: OperationId, description?: string) => ({
  type: "REGISTER_OPERATION" as const,
  id,
  description,
});

export const unregisterOperationAction = (id: OperationId) => ({
  type: "UNREGISTER_OPERATION" as const,
  id,
});

export const registerChildOperationAction = (id: OperationId, parentId: OperationId) => ({
  type: "REGISTER_CHILD_OPERATION" as const,
  id,
  parentId,
});

export const unregisterChildOperationAction = (id: OperationId, parentId: OperationId) => ({
  type: "UNREGISTER_CHILD_OPERATION" as const,
  id,
  parentId,
});

export type RegisterOperationAction = ReturnType<typeof registerOperationAction>;
export type UnregisterOperationAction = ReturnType<typeof unregisterOperationAction>;
export type RegisterChildOperationAction = ReturnType<typeof registerChildOperationAction>;
export type UnregisterChildOperationAction = ReturnType<typeof unregisterChildOperationAction>;

export type OperationContextAction =
  | RegisterOperationAction
  | UnregisterOperationAction
  | RegisterChildOperationAction
  | UnregisterChildOperationAction;
