/*
 * This saga listens to all dispatched redux actions and ships them (including their properties)
 * to the backend in batches, which forwards them to Loki. It is purely observational and must
 * never disrupt the application: sending is fire-and-forget and failures are swallowed.
 */

import { sendReduxActionLog } from "admin/rest_api";
import Date from "libs/date";
import { TAB_SESSION_ID } from "libs/tab_session_id";
import { buffers } from "redux-saga";
import { actionChannel, call, delay, race, take } from "typed-redux-saga";
import type { Action } from "viewer/model/actions/actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";

const FLUSH_INTERVAL_MS = 10000;
const MAX_BATCH_SIZE = 100;
// A single action whose serialized form exceeds this size is logged as type-only to avoid
// bloating a batch (e.g. actions carrying large data payloads).
const MAX_ACTION_SERIALIZED_LENGTH = 1000;

// Explicit allowlist of action types that are shipped to Loki, rather than a blacklist of ones
// that aren't. This is deliberately opt-out-by-default: a newly added action type is NOT logged
// until someone consciously adds it here, so we don't silently start shipping large or sensitive
// payloads just because nobody remembered to blacklist them.
// This list was seeded from every action type in the Action union that existed at the time this
// feature was added, minus the actionBlacklist in action_logger_middleware.ts (which remains in
// place, unchanged, for local console logging only). A few action-file "type" literals that are
// not part of the exported Action union (e.g. types only used internally by batchActions()) were
// excluded, since they can never be observed at this saga's actionChannel and don't typecheck.
// Each entry is checked against Action["type"] so a renamed/removed action type fails typecheck.
const LOGGED_ACTION_TYPES: ReadonlySet<Action["type"]> = new Set<Action["type"]>([
  "ADD_AD_HOC_MESH",
  "ADD_BUCKET_TO_UNDO",
  "ADD_CONNECTOME_TREES",
  "ADD_NEW_USER_BOUNDING_BOX",
  "ADD_PRECOMPUTED_MESH",
  "ADD_SEGMENT_GROUP",
  "ADD_TREES_AND_GROUPS",
  "ADD_USER_BOUNDING_BOXES",
  "ALLOW_SAGA_WHILE_BUSY_ACTION",
  "APPLY_SKELETON_UPDATE_ACTIONS_FROM_SERVER",
  "APPLY_VOLUME_UPDATE_ACTIONS_FROM_SERVER",
  "BATCH_UPDATE_GROUPS_AND_SEGMENTS",
  "CANCEL_QUICK_SELECT",
  "CANCEL_SAGA",
  "CENTER_ACTIVE_NODE",
  "CENTER_TD_VIEW",
  "CHANGE_USER_BOUNDING_BOX",
  "CLEAR_MAPPING",
  "CLEAR_PROOFREADING_BY_PRODUCTS",
  "CLICK_SEGMENT",
  "COMPUTE_QUICK_SELECT_FOR_POINT",
  "COMPUTE_QUICK_SELECT_FOR_RECT",
  "CONFIRM_QUICK_SELECT",
  "CREATE_BRANCHPOINT",
  "CREATE_CELL",
  "CREATE_COMMENT",
  "CREATE_NODE",
  "CREATE_TREE",
  "CUT_AGGLOMERATE_FROM_NEIGHBORS",
  "CYCLE_TOOL",
  "DELETE_BRANCHPOINT",
  "DELETE_BRANCHPOINT_BY_ID",
  "DELETE_COMMENT",
  "DELETE_CONNECTOME_TREES",
  "DELETE_EDGE",
  "DELETE_NODE",
  "DELETE_SEGMENT_DATA",
  "DELETE_TREE",
  "DELETE_TREES",
  "DELETE_USER_BOUNDING_BOX",
  "DESELECT_ACTIVE_TREE",
  "DESELECT_ACTIVE_TREE_GROUP",
  "DISABLE_SAVING",
  "DISALLOW_SAGA_WHILE_BUSY_ACTION",
  "DISCARD_SAVE_QUEUE",
  "EDIT_ANNOTATION_LAYER",
  "ENSURE_HAS_NEWEST_VERSION",
  "ENSURE_LAYER_MAPPINGS_ARE_LOADED",
  "ENSURE_SEGMENT_INDEX_IS_LOADED",
  "ENSURE_TRACINGS_WERE_DIFFED_TO_SAVE_QUEUE",
  "ENTER",
  "ESCALATE_ERROR",
  "ESCAPE",
  "EXITING_ANNOTATION",
  "EXPAND_PARENT_GROUPS_OF_TREE",
  "FINE_TUNE_QUICK_SELECT",
  "FINISH_ANNOTATION_STROKE",
  "FINISHED_APPLYING_MISSING_UPDATES",
  "FINISH_EDITING",
  "FINISHED_LOADING_MESH",
  "FINISHED_REBASING",
  "FINISHED_RESIZING_USER_BOUNDING_BOX",
  "FINISH_FORWARDING_UPDATE_ACTIONS",
  "FINISH_MAPPING_INITIALIZATION",
  "FLOOD_FILL",
  "FOCUS_TREE",
  "GET_NEW_ID",
  "HIDE_BRUSH",
  "HIDE_CONTEXT_MENU",
  "HIDE_MEASUREMENT_TOOLTIP",
  "IDS_REPLENISHED",
  "IDS_REPLENISHMENT_FAILED",
  "IMPORT_VOLUMETRACING",
  "INITIALIZE_ANNOTATION",
  "INITIALIZE_ANNOTATION_WITH_TRACINGS",
  "INITIALIZE_CONNECTOME_TRACING",
  "INITIALIZE_EDITABLE_MAPPING",
  "INITIALIZE_GPU_SETUP",
  "INITIALIZE_SETTINGS",
  "INITIALIZE_SKELETONTRACING",
  "INITIALIZE_VOLUMETRACING",
  "INTERPOLATE_SEGMENTATION_LAYER",
  "LOAD_AD_HOC_MESH_ACTION",
  "LOAD_AGGLOMERATE_TREE_AT_POSITION",
  "LOAD_AGGLOMERATE_TREE_FROM_ID",
  "LOAD_CONNECTOME_AGGLOMERATE_TREE",
  "LOAD_PRECOMPUTED_MESH_ACTION",
  "LOGOUT_USER",
  "MAYBE_FETCH_MESH_FILES",
  "MERGE_SEGMENTS_ITEMS",
  "MERGE_TREES",
  "MIN_CUT_AGGLOMERATE",
  "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS",
  "MIN_CUT_PARTITIONS",
  "MOVE_TD_VIEW_BY_VECTOR",
  "MOVE_TD_VIEW_BY_VECTOR_WITHOUT_TIME_TRACKING",
  "NONE",
  "NOTIFY_ABOUT_UPDATED_BUCKETS",
  "PERFORM_MIN_CUT",
  "PITCH_FLYCAM",
  "PREPARE_REBASING",
  "PROOFREAD_AT_POSITION",
  "PROOFREAD_MERGE",
  "REDO",
  "REFRESH_MESH",
  "REFRESH_MESHES",
  "RELOAD_HISTOGRAM",
  "REMOVE_CONNECTOME_AGGLOMERATE_TREE",
  "REMOVE_CONNECTOME_TRACING",
  "REMOVE_MESH",
  "REMOVE_SEGMENT",
  "REPLACE_SAVE_QUEUE",
  "REQUEST_DELETE_BRANCHPOINT",
  "REQUEST_ID_REPLENISHMENT",
  "RESET_CONTOUR",
  "RESET_MULTI_CUT_TOOL_PARTITIONS",
  "RESET_SKELETON_TRACING",
  "RESET_STORE",
  "RESTART_SAGA",
  "RETRY_MUTEX_ACQUISITION_NOW",
  "ROLL_FLYCAM",
  "ROTATE_FLYCAM",
  "SAVE_NOW",
  "SCENE_CONTROLLER_INITIALIZED",
  "SELECT_NEXT_TREE",
  "SET_ACTIVE_CELL",
  "SET_ACTIVE_CONNECTOME_AGGLOMERATE_IDS",
  "SET_ACTIVE_NODE",
  "SET_ACTIVE_ORGANIZATION",
  "SET_ACTIVE_ORGANIZATIONS_MILLI_CREDIT_BALANCE",
  "SET_ACTIVE_TREE",
  "SET_ACTIVE_TREE_BY_NAME",
  "SET_ACTIVE_USER",
  "SET_ACTIVE_USER_BOUNDING_BOX_ID",
  "SET_ADDITIONAL_COORDINATES",
  "SET_AI_JOB_DRAWER_STATE",
  "SET_ANNOTATION_ALLOW_UPDATE",
  "SET_ANNOTATION_DESCRIPTION",
  "SET_ANNOTATION_NAME",
  "SET_ANNOTATION_VISIBILITY",
  "SET_ARE_QUICK_SELECT_SETTINGS_OPEN",
  "SET_BORDER_OPEN_STATUS",
  "SET_BUSY_BLOCKING_INFO_ACTION",
  "SET_COLLABORATION_MODE",
  "SET_CONNECTOME_TREES_VISIBILITY",
  "SET_CONTOUR_TRACING_MODE",
  "SET_CONTROL_MODE",
  "SET_CREATE_ANIMATION_MODAL_VISIBILITY",
  "SET_DATASET",
  "SET_DOWNLOAD_MODAL_VISIBILITY",
  "SET_DROPZONE_MODAL_VISIBILITY",
  "SET_DUPLICATE_ANNOTATION_MODAL_VISIBILITY",
  "SET_EDGES_ARE_VISIBLE",
  "SET_EXPANDED_SEGMENT_GROUPS",
  "SET_EXPANDED_TREE_GROUPS_BY_IDS",
  "SET_EXPANDED_TREE_GROUPS_BY_KEYS",
  "SET_FLIGHTMODE_RECORDING",
  "SET_GLOBAL_PROGRESS",
  "SET_HAS_EDITABLE_MAPPING",
  "SET_HAS_ORGANIZATIONS",
  "SET_HIDE_UNMAPPED_IDS",
  "SET_HIDE_UNREGISTERED_SEGMENTS",
  "SET_HISTOGRAM_DATA_FOR_LAYER",
  "SET_ID_RESERVATIONS",
  "SET_IMPORTING_MESH_STATE",
  "SET_INPUT_CATCHER_RECTS",
  "SET_IS_IN_ANNOTATION_VIEW",
  "SET_IS_MEASURING",
  "SET_IS_MUTEX_ACQUIRED",
  "SET_IS_RESTORING_VERSION",
  "SET_IS_WK_INITIALIZED",
  "SET_KEYBOARD_LAYOUT_MAP",
  "SET_KEYBOARD_LAYOUT_MAP_ENTRY",
  "SET_KEYBOARD_SHORTCUT_CONFIG_MODAL_VISIBILITY",
  "SET_KEYBOARD_SHORTCUTS_CONFIG",
  "SET_LARGEST_SEGMENT_ID",
  "SET_LAST_MEASURED_POSITION",
  "SET_LAST_SAVE_TIMESTAMP",
  "SET_LAYER_HAS_SEGMENT_INDEX",
  "SET_LAYER_MAPPINGS",
  "SET_LAYER_TRANSFORMS",
  "SET_MAPPING",
  "SET_MAPPING_ENABLED",
  "SET_MAPPING_IS_LOCKED",
  "SET_MAPPING_NAME",
  "SET_MAXIMUM_ZOOM_FOR_ALL_MAGS_FOR_LAYER",
  "SET_MERGE_MODAL_VISIBILITY",
  "SET_MERGER_MODE_ENABLED",
  "SET_NAVBAR_HEIGHT",
  "SET_NODE_POSITION",
  "SET_NODE_RADIUS",
  "SET_PENDING_PROOFREADING_OPERATION_INFO",
  "SET_PYTHON_MODAL_VISIBILITY",
  "SET_QUICK_SELECT_STATE",
  "SET_SAVE_BUSY",
  "SET_SEGMENT_GROUPS",
  "SET_SEGMENTS",
  "SET_SELECTED_SEGMENTS_OR_GROUP",
  "SET_SHARE_MODAL_VISIBILITY",
  "SET_SHOW_SKELETONS",
  "SET_SKELETON_TRACING",
  "SET_STORED_LAYOUTS",
  "SET_TASK",
  "SET_TD_CAMERA_WITHOUT_TIME_TRACKING",
  "SET_THEME",
  "SET_TOOL",
  "SET_TREE_ACTIVE_GROUP",
  "SET_TREE_AGGLOMERATE_INFO_ID",
  "SET_TREE_COLOR",
  "SET_TREE_COLOR_INDEX",
  "SET_TREE_GROUP",
  "SET_TREE_GROUPS",
  "SET_TREE_METADATA",
  "SET_TREE_NAME",
  "SET_TREES_AGGLOMERATE_INFO_TRACING_ID",
  "SET_TREE_TYPE",
  "SET_TREE_VISIBILITY",
  "SET_USER_BOUNDING_BOXES",
  "SET_USER_HOLDING_MUTEX",
  "SET_USER_SCRIPTS_MODAL_VISIBILITY",
  "SET_VERSION_NUMBER",
  "SET_VERSION_RESTORE_VISIBILITY",
  "SET_VIEW_MODE",
  "SET_VOLUME_BUCKET_DATA_HAS_CHANGED",
  "SET_VOXEL_PIPETTE_TOOLTIP_PINNED_POSITION",
  "SET_ZARR_LINKS_MODAL_VISIBILITY",
  "SET_ZOOM_STEP",
  "SHIFT_SAVE_QUEUE",
  "SHOW_CONTEXT_MENU",
  "SHUFFLE_ALL_TREE_COLORS",
  "SHUFFLE_TREE_COLOR",
  "SNAPSHOT_ANNOTATION_STATE_FOR_NEXT_REBASE",
  "SNAPSHOT_MAPPING_DATA_FOR_NEXT_REBASE_ACTION",
  "START_EDITING",
  "STARTED_LOADING_MESH",
  "START_FORWARDING_UPDATE_ACTIONS",
  "SUBSCRIBE_TO_ANNOTATION_MUTEX",
  "TOGGLE_ALL_SEGMENTS",
  "TOGGLE_ALL_TREES",
  "TOGGLE_INACTIVE_TREES",
  "TOGGLE_SEGMENT_GROUP",
  "TOGGLE_SEGMENT_IN_PARTITION",
  "TOGGLE_TEMPORARY_SETTING",
  "TOGGLE_TREE",
  "TOGGLE_TREE_GROUP",
  "TRIGGER_MESH_DOWNLOAD",
  "TRIGGER_MESHES_DOWNLOAD",
  "UI_READY",
  "UNDO",
  "UNSUBSCRIBE_FROM_ANNOTATION_MUTEX",
  "UPDATE_CONNECTOME_FILE_LIST",
  "UPDATE_CURRENT_CONNECTOME_FILE",
  "UPDATE_CURRENT_MESH_FILE",
  "UPDATE_DATASET_SETTING",
  "UPDATE_DIRECTION",
  "UPDATE_LAYER_SETTING",
  "UPDATE_MESH_FILE_LIST",
  "UPDATE_MESH_OPACITY",
  "UPDATE_MESH_VISIBILITY",
  "UPDATE_NAVIGATION_LIST",
  "UPDATE_PROOFREADING_MARKER_POSITION",
  "UPDATE_SEGMENT",
  "UPDATE_USER_SETTING",
  "WK_INITIALIZED",
  "YAW_FLYCAM",
  "ZOOM_BY_DELTA",
  "ZOOM_IN",
  "ZOOM_OUT",
]);

type ActionLogEntry = { timestamp: number; action: unknown };

// Returns a JSON-safe representation of the action. Falls back to a type-only entry if the
// action is too large or cannot be serialized (e.g. circular references), so that a single
// problematic action never causes the whole batch send to fail.
function sanitizeAction(action: Action): unknown {
  try {
    const serialized = JSON.stringify(action);
    if (serialized == null) {
      return { type: action.type };
    }
    if (serialized.length > MAX_ACTION_SERIALIZED_LENGTH) {
      return { type: action.type, _truncated: true };
    }
    return action;
  } catch (_error) {
    return { type: action.type, _unserializable: true };
  }
}

function collect(buffer: ActionLogEntry[], action: Action): void {
  if (!LOGGED_ACTION_TYPES.has(action.type)) {
    return;
  }
  buffer.push({ timestamp: Date.now(), action: sanitizeAction(action) });
}

export default function* reduxActionLoggingSaga(): Saga<void> {
  yield* call(ensureWkInitialized);

  // Test balloon: only ship action logs for super users for now, to avoid sending too much
  // data over the wire before the volume/usefulness tradeoff has been evaluated.
  const activeUser = yield* select((state) => state.activeUser);
  if (activeUser == null || !activeUser.isSuperUser) {
    return;
  }

  // Use an actionChannel so that no actions are missed while a batch is being sent.
  const channel = yield* actionChannel("*", buffers.expanding<Action>());
  let buffer: ActionLogEntry[] = [];

  while (true) {
    // Block until at least one action arrives, then keep accumulating until the batch is full
    // or the flush interval elapses.
    const firstAction = yield* take(channel);
    collect(buffer, firstAction);

    while (buffer.length < MAX_BATCH_SIZE) {
      const { action } = yield* race({
        action: take(channel),
        timeout: delay(FLUSH_INTERVAL_MS),
      });
      if (action == null) {
        // Flush interval elapsed.
        break;
      }
      collect(buffer, action);
    }

    if (buffer.length > 0) {
      const batch = buffer;
      buffer = [];
      try {
        yield* call(sendReduxActionLog, TAB_SESSION_ID, batch);
      } catch (_error) {
        // Fire-and-forget: dropping the batch is acceptable and must not disrupt the app.
      }
    }
  }
}
