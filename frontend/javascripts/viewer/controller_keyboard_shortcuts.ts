import constants from "viewer/constants";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { redoAction, undoAction } from "viewer/model/actions/save_actions";
import { setViewModeAction, updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import type {
  KeyBindingMap,
  KeyboardHandler,
  KeyboardShortcutHandlerMap,
  KeyboardShortcutsMap,
} from "libs/input";
import type DataLayer from "viewer/model/data_layer";

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

export const GeneralKeyboardShortcutsSchema = {
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
