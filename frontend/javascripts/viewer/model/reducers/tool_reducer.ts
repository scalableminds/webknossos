import type { Action } from "viewer/model/actions/actions";
import {
  getNextTool,
  getPreviousTool,
  setToolReducer,
} from "viewer/model/reducers/reducer_helpers";
import { hideBrushReducer } from "viewer/model/reducers/volumetracing_reducer_helpers";
import type { WebknossosState } from "viewer/store";

// Switching tools depends on the viewer's accessors (and thereby on three.js). That's why this
// is not part of UiReducer, which is also used outside of the viewer (see viewer/store.ts).
function ToolReducer(state: WebknossosState, action: Action): WebknossosState {
  switch (action.type) {
    case "SET_TOOL": {
      return setToolReducer(hideBrushReducer(state), action.tool);
    }

    case "CYCLE_TOOL": {
      const nextTool = action.backwards ? getPreviousTool(state) : getNextTool(state);

      if (nextTool == null) {
        // Don't change the current tool if another tool could not be selected.
        return state;
      }

      return setToolReducer(hideBrushReducer(state), nextTool);
    }

    default:
      return state;
  }
}

export default ToolReducer;
