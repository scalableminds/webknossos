import type { Action } from "viewer/model/actions/actions";
import type { WebknossosState } from "viewer/store";

function OperationContextReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "REGISTER_OPERATION":
      return {
        ...state,
        operationContext: {
          ...state.operationContext,
          activeOperations: [...state.operationContext.activeOperations, action.id],
        },
      };
    case "UNREGISTER_OPERATION":
      return {
        ...state,
        operationContext: {
          activeOperations: state.operationContext.activeOperations.filter(
            (id) => id !== action.id,
          ),
          // Children cannot outlive their parent operation.
          childOperations: state.operationContext.childOperations.filter(
            (c) => c.parentId !== action.id,
          ),
        },
      };
    case "REGISTER_CHILD_OPERATION":
      return {
        ...state,
        operationContext: {
          ...state.operationContext,
          childOperations: [
            ...state.operationContext.childOperations,
            { id: action.id, parentId: action.parentId },
          ],
        },
      };
    case "UNREGISTER_CHILD_OPERATION":
      return {
        ...state,
        operationContext: {
          ...state.operationContext,
          childOperations: state.operationContext.childOperations.filter(
            (c) => c.id !== action.id,
          ),
        },
      };
    default:
      return state;
  }
}

export default OperationContextReducer;
