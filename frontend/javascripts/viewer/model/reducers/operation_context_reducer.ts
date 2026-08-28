import type { Action } from "viewer/model/actions/actions";
import type { WebknossosState } from "viewer/store";

function OperationContextReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "REGISTER_OPERATION":
      if (state.operationContext.activeOperations.some((op) => op.id === action.id)) {
        throw new Error(`Operation "${action.id}" is already registered`);
      }
      return {
        ...state,
        operationContext: {
          ...state.operationContext,
          activeOperations: [
            ...state.operationContext.activeOperations,
            { id: action.id, description: action.description },
          ],
        },
      };
    case "UNREGISTER_OPERATION":
      return {
        ...state,
        operationContext: {
          activeOperations: state.operationContext.activeOperations.filter(
            (op) => op.id !== action.id,
          ),
          // Children cannot outlive their parent operation.
          childOperations: state.operationContext.childOperations.filter(
            (c) => c.parentId !== action.id,
          ),
        },
      };
    case "REGISTER_CHILD_OPERATION":
      if (
        state.operationContext.childOperations.some(
          (c) => c.id === action.id && c.parentId === action.parentId,
        )
      ) {
        throw new Error(
          `Child operation "${action.id}" is already registered under parent "${action.parentId}"`,
        );
      }
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
            (c) => !(c.id === action.id && c.parentId === action.parentId),
          ),
        },
      };
    default:
      return state;
  }
}

export default OperationContextReducer;
