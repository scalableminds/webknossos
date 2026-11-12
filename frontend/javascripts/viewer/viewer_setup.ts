import { setupApi } from "viewer/api/internal_api";
import Model from "viewer/model";
import { rootReducer } from "viewer/model/reducers/root_reducer";
import { setModel } from "viewer/singletons";
import { setRootReducer } from "viewer/store";

// Initializes the global state that the viewer relies on. Called once when the viewer's code
// is loaded (see viewer/viewer_entry.ts) before any of the viewer's components are rendered.
export function setupViewer() {
  // setupApi reads the Model singleton, so it has to be set first.
  setModel(Model);
  setupApi();
  setRootReducer(rootReducer);
}
