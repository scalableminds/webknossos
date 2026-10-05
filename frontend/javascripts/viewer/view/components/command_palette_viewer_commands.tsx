import type { ItemType } from "antd/es/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { getPhraseFromCamelCaseString } from "libs/utils";
import compact from "lodash-es/compact";
import noop from "lodash-es/noop";
import { useEffect, useMemo } from "react";
import { useDispatch } from "react-redux";
import { ColorWKBlue } from "theme";
import { ViewModeValues } from "viewer/constants";
import { mayEditAnnotation } from "viewer/model/accessors/annotation_accessor";
import { AnnotationTool, Toolkits } from "viewer/model/accessors/tool_accessor";
import { setViewModeAction, updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setToolAction } from "viewer/model/actions/ui_actions";
import type { UserConfiguration } from "viewer/store";
import {
  type TracingViewMenuProps,
  useTracingViewMenuItems,
} from "../action_bar/use_tracing_view_menu_items";
import { viewDatasetMenu } from "../action_bar/view_dataset_actions_view";
import { LayoutEvents, layoutEmitter } from "../layouting/layout_persistence";
import { type CommandWithoutId, setViewerCommands } from "./command_palette";

const getLabelForAction = (action: NonNullable<ItemType>) => {
  if ("title" in action && action.title != null) {
    return action.title;
  }
  if ("label" in action && action.label != null) {
    return action.label.toString();
  }
  throw new Error("No label found for action");
};

const mapMenuActionsToCommands = (menuActions: Array<ItemType>): CommandWithoutId[] => {
  return compact(
    menuActions.map((action) => {
      if (action == null) {
        return null;
      }
      const onClickAction = "onClick" in action && action.onClick != null ? action.onClick : noop;
      return {
        name: getLabelForAction(action),
        command: onClickAction,
        color: ColorWKBlue,
      };
    }),
  );
};

const shortCutDictForTools: Record<string, string> = {
  [AnnotationTool.MOVE.id]: "Ctrl + K, M",
  [AnnotationTool.SKELETON.id]: "Ctrl + K, S",
  [AnnotationTool.BRUSH.id]: "Ctrl + K, B",
  [AnnotationTool.ERASE_BRUSH.id]: "Ctrl + K, E",
  [AnnotationTool.TRACE.id]: "Ctrl + K, L",
  [AnnotationTool.ERASE_TRACE.id]: "Ctrl + K, R",
  [AnnotationTool.VOXEL_PIPETTE.id]: "Ctrl + K, P",
  [AnnotationTool.QUICK_SELECT.id]: "Ctrl + K, Q",
  [AnnotationTool.BOUNDING_BOX.id]: "Ctrl + K, X",
  [AnnotationTool.PROOFREAD.id]: "Ctrl + K, O",
};

// Adds the commands which are only available within the viewer to the command palette. The palette
// itself is shown on every page and therefore must not import the viewer's code.
export function CommandPaletteViewerCommands() {
  const dispatch = useDispatch();

  const userConfig = useWkSelector((state) => state.userConfiguration);
  const isViewMode = useWkSelector((state) => state.temporaryConfiguration.controlMode === "VIEW");
  const isInAnnotationView = useWkSelector((state) => state.uiInformation.isInAnnotationView);

  const restrictions = useWkSelector((state) => state.annotation.restrictions);
  const allowUpdate = useWkSelector(mayEditAnnotation);
  const task = useWkSelector((state) => state.task);
  const annotationType = useWkSelector((state) => state.annotation.annotationType);
  const annotationId = useWkSelector((state) => state.annotation.annotationId);
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAnnotationLockedByUser = useWkSelector((state) => state.annotation.isLockedByOwner);
  const annotationOwner = useWkSelector((state) => state.annotation.owner);

  const props: TracingViewMenuProps = {
    restrictions,
    task,
    annotationType,
    annotationId,
    activeUser,
    isAnnotationLockedByUser,
    annotationOwner,
  };
  const tracingMenuItems = useTracingViewMenuItems(props, null);

  const commands = useMemo(() => {
    if (!isInAnnotationView) return [];

    const getToolEntries = () => {
      const commands: CommandWithoutId[] = [];
      let availableTools = Object.values(AnnotationTool);
      if (isViewMode || !allowUpdate) {
        availableTools = Toolkits.READ_ONLY_TOOLS;
      }
      availableTools.forEach((tool) => {
        commands.push({
          name: `Switch to ${tool.readableName}`,
          command: () => dispatch(setToolAction(tool)),
          shortcut: shortCutDictForTools[tool.id] || "",
          color: ColorWKBlue,
        });
      });
      return commands;
    };

    const getViewModeEntries = () => {
      const commands: CommandWithoutId[] = ViewModeValues.map((mode) => ({
        name: `Switch to ${mode} mode`,
        command: () => {
          dispatch(setViewModeAction(mode));
        },
        color: ColorWKBlue,
      }));
      commands.push({
        name: "Reset layout",
        command: () => layoutEmitter.emit(LayoutEvents.resetLayout),
        color: ColorWKBlue,
      });
      return commands;
    };

    const getTabsAndSettingsMenuItems = () => {
      const commands: CommandWithoutId[] = [];

      (Object.keys(userConfig) as [keyof UserConfiguration]).forEach((key) => {
        if (typeof userConfig[key] === "boolean" && key !== "renderWatermark") {
          // removing the watermark is a paid feature
          commands.push({
            name: `Toggle ${getPhraseFromCamelCaseString(key)}`,
            command: () => dispatch(updateUserSettingAction(key, !userConfig[key])),
            color: ColorWKBlue,
          });
        }
      });
      return commands;
    };

    const menuActions = isViewMode ? viewDatasetMenu : tracingMenuItems;

    return [
      ...getToolEntries(),
      ...getViewModeEntries(),
      ...mapMenuActionsToCommands(menuActions),
      ...getTabsAndSettingsMenuItems(),
    ];
  }, [isInAnnotationView, isViewMode, allowUpdate, userConfig, tracingMenuItems, dispatch]);

  useEffect(() => {
    setViewerCommands(commands);
    return () => setViewerCommands([]);
  }, [commands]);

  return null;
}
