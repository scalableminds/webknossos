export type OperationId = string;

export type RegisterOperationAction = {
  type: "REGISTER_OPERATION";
  id: OperationId;
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
};

export type OperationContextAction =
  | RegisterOperationAction
  | UnregisterOperationAction
  | RegisterChildOperationAction
  | UnregisterChildOperationAction;

export const registerOperationAction = (id: OperationId): RegisterOperationAction => ({
  type: "REGISTER_OPERATION",
  id,
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
): UnregisterChildOperationAction => ({
  type: "UNREGISTER_CHILD_OPERATION",
  id,
});
