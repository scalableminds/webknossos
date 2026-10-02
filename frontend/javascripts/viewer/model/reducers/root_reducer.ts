import reduceReducers from "viewer/model/helpers/reduce_reducers";
import AnnotationReducer from "viewer/model/reducers/annotation_reducer";
import ConnectomeReducer from "viewer/model/reducers/connectome_reducer";
import DatasetReducer from "viewer/model/reducers/dataset_reducer";
import FlycamInfoCacheReducer from "viewer/model/reducers/flycam_info_cache_reducer";
import FlycamReducer from "viewer/model/reducers/flycam_reducer";
import MipBBoxReducer from "viewer/model/reducers/mip_bbox_reducer";
import OperationContextReducer from "viewer/model/reducers/operation_context_reducer";
import OrganizationReducer from "viewer/model/reducers/organization_reducer";
import ProofreadingReducer from "viewer/model/reducers/proofreading_reducer";
import { withRebaseEditGuard } from "viewer/model/reducers/rebase_edit_guard";
import SaveReducer from "viewer/model/reducers/save_reducer";
import SettingsReducer from "viewer/model/reducers/settings_reducer";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import TaskReducer from "viewer/model/reducers/task_reducer";
import ToolReducer from "viewer/model/reducers/tool_reducer";
import UiReducer from "viewer/model/reducers/ui_reducer";
import UserReducer from "viewer/model/reducers/user_reducer";
import ViewModeReducer from "viewer/model/reducers/view_mode_reducer";
import VolumeTracingReducer from "viewer/model/reducers/volumetracing_reducer";
import type { Reducer } from "viewer/store";

// All reducers of the store. The store starts out with only a subset of them (see viewer/store.ts),
// because most of these reducers are only needed in the viewer and would pull the viewer's code
// into every page. The viewer installs the complete reducer when it is loaded (see viewer/viewer_setup.ts).
export const combinedReducer = reduceReducers(
  SettingsReducer,
  DatasetReducer,
  SkeletonTracingReducer,
  VolumeTracingReducer,
  ProofreadingReducer,
  TaskReducer,
  SaveReducer,
  FlycamReducer,
  FlycamInfoCacheReducer,
  ViewModeReducer,
  AnnotationReducer,
  UserReducer,
  UiReducer,
  ToolReducer,
  ConnectomeReducer,
  OrganizationReducer,
  MipBBoxReducer,
  OperationContextReducer,
) as Reducer;

export const rootReducer = withRebaseEditGuard(combinedReducer);
