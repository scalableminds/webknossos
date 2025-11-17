import constants from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { redoAction, undoAction } from "viewer/model/actions/save_actions";
import {
  setFlightmodeRecordingAction,
  setViewModeAction,
  updateLayerSettingAction,
} from "viewer/model/actions/settings_actions";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import type {
  KeyBindingMap,
  KeyboardHandler,
  KeyboardShortcutHandlerMap,
  KeyboardShortcutsMap,
} from "libs/input";
import type DataLayer from "viewer/model/data_layer";
import {
  moveFlycamAction,
  pitchFlycamAction,
  yawFlycamAction,
  zoomInAction,
  zoomOutAction,
} from "viewer/model/actions/flycam_actions";
import {
  getMoveOffset3d,
  getPosition,
  getRotationInDegrees,
} from "viewer/model/accessors/flycam_accessor";
import { createNodeAction } from "viewer/model/actions/skeletontracing_actions";
import { untransformNodePosition } from "viewer/model/accessors/skeletontracing_accessor";

export const KeyboardShortcutsSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "KeyboardShortcutsMap",
  type: "object",

  description: "A mapping from key combos to valid handler IDs.",

  patternProperties: {
    ".*": {
      type: "string",
      enum: [
        "SWITCH_VIEWMODE_PLANE",
        "SWITCH_VIEWMODE_ARBITRARY",
        "SWITCH_VIEWMODE_ARBITRARY_PLANE",
        "CYCLE_VIEWMODE",
        "TOGGLE_SEGMENTATION",
        "SAVE",
        "UNDO",
        "REDO",
      ],
    },
  },

  additionalProperties: false,
};

// ----------------------------------------------------- Shortcuts used by controller.ts -----------------------------------------------------------------
export enum GeneralKeyboardShortcuts {
  SWITCH_VIEWMODE_PLANE = "SWITCH_VIEWMODE_PLANE",
  SWITCH_VIEWMODE_ARBITRARY = "SWITCH_VIEWMODE_ARBITRARY",
  SWITCH_VIEWMODE_ARBITRARY_PLANE = "SWITCH_VIEWMODE_ARBITRARY_PLANE",
  CYCLE_VIEWMODE = "CYCLE_VIEWMODE",
  TOGGLE_SEGMENTATION = "TOGGLE_SEGMENTATION",
}

export enum GeneralEditingKeyboardShortcuts {
  SAVE = "SAVE",
  UNDO = "UNDO",
  REDO = "REDO",
}

export const ALL_HANDLER_IDS = [
  ...Object.values(GeneralKeyboardShortcuts),
  ...Object.values(GeneralEditingKeyboardShortcuts),
] as const;

const getHandleToggleSegmentation = (): KeyboardHandler => {
  let leastRecentlyUsedSegmentationLayer: DataLayer | null = null;
  return function toggleSegmentationOpacity() {
    let segmentationLayer = Model.getVisibleSegmentationLayer();

    if (segmentationLayer != null) {
      // If there is a visible segmentation layer, disable and remember it.
      leastRecentlyUsedSegmentationLayer = segmentationLayer;
    } else if (leastRecentlyUsedSegmentationLayer != null) {
      // If no segmentation layer is visible, use the least recently toggled
      // layer (note that toggling the layer via the switch-button won't update
      // the local variable here).
      segmentationLayer = leastRecentlyUsedSegmentationLayer;
    } else {
      // As a fallback, simply use some segmentation layer
      segmentationLayer = Model.getSomeSegmentationLayer();
    }

    if (segmentationLayer == null) {
      return;
    }

    const segmentationLayerName = segmentationLayer.name;
    const isSegmentationDisabled =
      Store.getState().datasetConfiguration.layers[segmentationLayerName].isDisabled;
    Store.dispatch(
      updateLayerSettingAction(segmentationLayerName, "isDisabled", !isSegmentationDisabled),
    );
  };
};

export const DEFAULT_GENERAL_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralKeyboardShortcuts> = {
  "shift + 1": GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE,
  "shift + 2": GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY,
  "shift + 3": GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE,
  m: GeneralKeyboardShortcuts.CYCLE_VIEWMODE,
  "3": GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION,
};

export const DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralEditingKeyboardShortcuts> =
  {
    "super + s": GeneralEditingKeyboardShortcuts.SAVE,
    "ctrl + s": GeneralEditingKeyboardShortcuts.SAVE,
    "super + z": GeneralEditingKeyboardShortcuts.UNDO,
    "ctrl + z": GeneralEditingKeyboardShortcuts.UNDO,
    "super + y": GeneralEditingKeyboardShortcuts.REDO,
    "ctrl + y": GeneralEditingKeyboardShortcuts.REDO,
  };

function getGeneralKeyboardShortcutsHandlerMap() {
  // Wrapped in a function to ensure each time the map is used, a new instance of getHandleToggleSegmentation
  // is created and thus "leastRecentlyUsedSegmentationLayer" not being shared between key binding maps.
  const CONTROLLER_KEYBOARD_SHORTCUTS_HANDLER_MAP: KeyboardShortcutHandlerMap<
    GeneralKeyboardShortcuts | GeneralEditingKeyboardShortcuts
  > = {
    [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: () => {
      Store.dispatch(setViewModeAction(constants.MODE_PLANE_TRACING));
    },
    [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: () => {
      Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY));
    },
    [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]: () => {
      Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY_PLANE));
    },
    [GeneralKeyboardShortcuts.CYCLE_VIEWMODE]: () => {
      // rotate allowed modes
      const state = Store.getState();
      const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
      const currentViewMode = state.temporaryConfiguration.viewMode;
      if (isProofreadingActive && currentViewMode === constants.MODE_PLANE_TRACING) {
        // Skipping cycling view mode as m in proofreading is used to toggle multi cut tool.
        return;
      }
      const { allowedModes } = state.annotation.restrictions;
      const index = (allowedModes.indexOf(currentViewMode) + 1) % allowedModes.length;
      Store.dispatch(setViewModeAction(allowedModes[index]));
    },
    [GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION]: getHandleToggleSegmentation(),
    [GeneralEditingKeyboardShortcuts.SAVE]: (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      Model.forceSave();
    },
    // Undo
    [GeneralEditingKeyboardShortcuts.UNDO]: (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      Store.dispatch(undoAction());
    },
    [GeneralEditingKeyboardShortcuts.REDO]: (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      Store.dispatch(redoAction());
    },
  };
  return CONTROLLER_KEYBOARD_SHORTCUTS_HANDLER_MAP;
}

type GeneralKeyboardShortcut = GeneralEditingKeyboardShortcuts | GeneralKeyboardShortcuts;

export const buildGeneralKeyBindings = (
  config: KeyboardShortcutsMap<string>,
  isInViewMode: boolean,
): KeyBindingMap => {
  const handlerMap = getGeneralKeyboardShortcutsHandlerMap();

  const allowedShortcutPairs = Object.entries(config).filter(([_keyCombo, handlerId]) => {
    const isEditingShortcut = handlerId in GeneralEditingKeyboardShortcuts;
    return !(isInViewMode && isEditingShortcut);
  });
  const mappedShortcuts = allowedShortcutPairs
    .map(([keyCombo, handlerId]) =>
      handlerId in handlerMap
        ? ([keyCombo, handlerMap[handlerId as GeneralKeyboardShortcut]] as [
            string,
            KeyboardHandler,
          ])
        : undefined,
    )
    .filter((mapping) => mapping != null);
  return Object.fromEntries(mappedShortcuts);
};

// ---------------------------------------- Shortcuts used by arbitrary_controller.ts ---------------------------------------------------------------------------

enum ArbitraryControllerNavigationKeyboardShortcuts {
  MOVE_FORWARD_WITH_RECORDING = "MOVE_FORWARD_WITH_RECORDING",
  MOVE_BACKWARD_WITH_RECORDING = "MOVE_BACKWARD_WITH_RECORDING",
  MOVE_FORWARD_WITHOUT_RECORDING = "MOVE_FORWARD_WITHOUT_RECORDING",
  MOVE_BACKWARD_WITHOUT_RECORDING = "MOVE_BACKWARD_WITHOUT_RECORDING",
  YAW_FLYCAM_POSITIVE_AT_CENTER = "YAW_FLYCAM_POSITIVE_AT_CENTER",
  YAW_FLYCAM_INVERTED_AT_CENTER = "YAW_FLYCAM_INVERTED_AT_CENTER",
  PITCH_FLYCAM_POSITIVE_AT_CENTER = "PITCH_FLYCAM_POSITIVE_AT_CENTER",
  PITCH_FLYCAM_INVERTED_AT_CENTER = "PITCH_FLYCAM_INVERTED_AT_CENTER",
  YAW_FLYCAM_POSITIVE_IN_DISTANCE = "YAW_FLYCAM_POSITIVE_IN_DISTANCE",
  YAW_FLYCAM_INVERTED_IN_DISTANCE = "YAW_FLYCAM_INVERTED_IN_DISTANCE",
  PITCH_FLYCAM_POSITIVE_IN_DISTANCE = "PITCH_FLYCAM_POSITIVE_IN_DISTANCE",
  PITCH_FLYCAM_INVERTED_IN_DISTANCE = "PITCH_FLYCAM_INVERTED_IN_DISTANCE",
  ZOOM_IN_ARBITRARY = "ZOOM_IN_ARBITRARY",
  ZOOM_OUT_ARBITRARY = "ZOOM_OUT_ARBITRARY",
}

function handleCreateNode(): void {
  const state = Store.getState();
  if (!state.temporaryConfiguration.flightmodeRecording) {
    return;
  }
  const position = getPosition(state.flycam);
  const rotation = getRotationInDegrees(state.flycam);
  const additionalCoordinates = state.flycam.additionalCoordinates;
  Store.dispatch(
    createNodeAction(
      untransformNodePosition(position, state),
      additionalCoordinates,
      rotation,
      constants.ARBITRARY_VIEW,
      0,
    ),
  );
}

function setRecord(record: boolean): void {
  if (record !== Store.getState().temporaryConfiguration.flightmodeRecording) {
    Store.dispatch(setFlightmodeRecordingAction(record));
    handleCreateNode();
  }
}

function move(timeFactor: number): void {
  Store.dispatch(moveFlycamAction([0, 0, getMoveOffset3d(Store.getState(), timeFactor)]));
  this.moved();
}

// TODOM: Maybe move builders into their respective file and only keep handle ids here.

// Or even better: The respective files define their "blueprint": HandlerID to Function map and pass it to a generic keyboard shortcut builder :D

function moved(): void {
  const matrix = Store.getState().flycam.currentMatrix;

  if (this.lastNodeMatrix == null) {
    this.lastNodeMatrix = matrix;
  }

  const { lastNodeMatrix } = this;
  const vector: Vector3 = [
    lastNodeMatrix[12] - matrix[12],
    lastNodeMatrix[13] - matrix[13],
    lastNodeMatrix[14] - matrix[14],
  ];
  const vectorLength = V3.length(vector);

  if (vectorLength > 10) {
    handleCreateNode();
    this.lastNodeMatrix = matrix;
  }
}

const ARBITRARY_CONTROLLER_NAVIGATION_KEYBOARD_SHORTCUT_HANDLER_MAP = {
  // KeyboardJS is sensitive to ordering (complex combos first)
  // Move
  [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITH_RECORDING]: (
    timeFactor: number,
  ) => {
    this.setRecord(true);
    this.move(timeFactor);
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITH_RECORDING]: (
    timeFactor: number,
  ) => {
    this.setRecord(true);
    this.move(-timeFactor);
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITHOUT_RECORDING]: (
    timeFactor: number,
  ) => {
    this.setRecord(false);
    this.move(timeFactor);
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITHOUT_RECORDING]: (
    timeFactor: number,
  ) => {
    this.setRecord(false);
    this.move(-timeFactor);
  },
  // Rotate at centre
  [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_AT_CENTER]: (
    timeFactor: number,
  ) => {
    const rotateValue = Store.getState().userConfiguration.rotateValue;
    Store.dispatch(yawFlycamAction(rotateValue * timeFactor));
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_AT_CENTER]: (
    timeFactor: number,
  ) => {
    const rotateValue = Store.getState().userConfiguration.rotateValue;
    Store.dispatch(yawFlycamAction(-rotateValue * timeFactor));
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_AT_CENTER]: (
    timeFactor: number,
  ) => {
    const rotateValue = Store.getState().userConfiguration.rotateValue;
    Store.dispatch(pitchFlycamAction(rotateValue * timeFactor));
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_AT_CENTER]: (
    timeFactor: number,
  ) => {
    const rotateValue = Store.getState().userConfiguration.rotateValue;
    Store.dispatch(pitchFlycamAction(-rotateValue * timeFactor));
  },
  // Rotate in distance
  [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_IN_DISTANCE]: (
    timeFactor: number,
  ) => {
    const storeState = Store.getState();
    const rotateValue = storeState.userConfiguration.rotateValue;
    const isArbitrary = storeState.temporaryConfiguration.viewMode === constants.MODE_ARBITRARY;
    Store.dispatch(yawFlycamAction(rotateValue * timeFactor, isArbitrary));
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_IN_DISTANCE]: (
    timeFactor: number,
  ) => {
    const storeState = Store.getState();
    const rotateValue = storeState.userConfiguration.rotateValue;
    const isArbitrary = storeState.temporaryConfiguration.viewMode === constants.MODE_ARBITRARY;
    Store.dispatch(yawFlycamAction(-rotateValue * timeFactor, isArbitrary));
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_IN_DISTANCE]: (
    timeFactor: number,
  ) => {
    const storeState = Store.getState();
    const rotateValue = storeState.userConfiguration.rotateValue;
    const isArbitrary = storeState.temporaryConfiguration.viewMode === constants.MODE_ARBITRARY;
    Store.dispatch(pitchFlycamAction(-rotateValue * timeFactor, isArbitrary));
  },
  [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_IN_DISTANCE]: (
    timeFactor: number,
  ) => {
    const storeState = Store.getState();
    const rotateValue = storeState.userConfiguration.rotateValue;
    const isArbitrary = storeState.temporaryConfiguration.viewMode === constants.MODE_ARBITRARY;
    Store.dispatch(pitchFlycamAction(rotateValue * timeFactor, isArbitrary));
  },
  // Zoom in/out
  i: () => {
    Store.dispatch(zoomInAction());
  },
  o: () => {
    Store.dispatch(zoomOutAction());
  },
};
