import type { ItemType } from "antd/lib/menu/interface";
import { capitalize, getPhraseFromCamelCaseString } from "libs/utils";
import * as Utils from "libs/utils";
import _ from "lodash";
import { getAdministrationSubMenu } from "navbar";
import { AnnotationToolEnum, AvailableToolsInViewMode } from "oxalis/constants";
import { getLabelForTool } from "oxalis/model/accessors/tool_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { Store } from "oxalis/singletons";
import type { OxalisState, UserConfiguration } from "oxalis/store";
import type { Command } from "react-command-palette";
import ReactCommandPalette from "react-command-palette";
import { useSelector } from "react-redux";
import { getThemeFromUser } from "theme";
import {
  type TracingViewMenuProps,
  getTracingViewModalsAndMenuItems,
} from "../action-bar/tracing_actions_view";
import { getViewDatasetMenu } from "../action-bar/view_dataset_actions_view";
import { commandPaletteDarkTheme, commandPaletteLightTheme } from "./command_palette_theme";

const getLabelForAction = (action: ItemType) => {
  if (action == null) return "";
  if ("title" in action && action.title != null) {
    return action.title;
  }
  if ("label" in action && action.label != null) {
    return action.label.toString();
  }
  return "";
};

const mapMenuActionsToCommands = (menuActions: Array<ItemType>): Command[] => {
  if (menuActions == null) return [];
  return menuActions
    .filter((action) => action != null && getLabelForAction(action) != null)
    .map((action, counter) => {
      // the typechecker is not able to infer that action is not null here, probably because of the type ItemType
      const onClickAction =
        action != null && "onClick" in action && action["onClick"] != null
          ? action["onClick"]
          : _.noop;
      return {
        name: getLabelForAction(action),
        command: onClickAction,
        color: "#5660ff",
        id: counter,
      };
    });
};

const getLabelForPath = (key: string) =>
  getPhraseFromCamelCaseString(capitalize(key.split("/")[1])) || key;

export const CommandPalette = ({ label }: { label: string | null }) => {
  const userConfig = useSelector((state: OxalisState) => state.userConfiguration);
  const isViewMode = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.controlMode === "VIEW",
  );
  const isInTracingView = useSelector(
    (state: OxalisState) => state.uiInformation.isInAnnotationView,
  );

  const props: TracingViewMenuProps = useSelector((state: OxalisState) => {
    return {
      restrictions: state.tracing.restrictions,
      task: state.task,
      annotationType: state.tracing.annotationType,
      annotationId: state.tracing.annotationId,
      activeUser: state.activeUser,
      isAnnotationLockedByUser: state.tracing.isLockedByOwner,
      annotationOwner: state.tracing.owner,
      isDownloadModalOpen: state.uiInformation.showDownloadModal,
      isRenderAnimationModalOpen: state.uiInformation.showRenderAnimationModal,
      isShareModalOpen: state.uiInformation.showShareModal,
      isMergeModalOpen: state.uiInformation.showMergeAnnotationModal,
      isZarrPrivateLinksModalOpen: state.uiInformation.showZarrPrivateLinksModal,
      isUserScriptsModalOpen: state.uiInformation.showAddScriptModal,
    };
  });

  const { activeUser, restrictions } = props;

  const theme = getThemeFromUser(activeUser);

  const getMenuActions = (isViewMode: boolean) => {
    if (!isInTracingView) return [];
    if (isViewMode) {
      const { items } = getViewDatasetMenu(null);
      return items;
    }
    const { menuItems } = getTracingViewModalsAndMenuItems(props, null);
    return menuItems;
  };

  const getTabsAndSettingsMenuItems = () => {
    if (!isInTracingView) return [];
    const commands: Command[] = [];

    (Object.keys(userConfig) as [keyof UserConfiguration]).forEach((key, counter) => {
      if (typeof userConfig[key] === "boolean") {
        commands.push({
          id: counter,
          name: `Toggle ${getPhraseFromCamelCaseString(key)}`,
          command: () => Store.dispatch(updateUserSettingAction(key, !userConfig[key])),
          color: "#5660ff",
        });
      }
    });
    return commands;
  };

  const getNavigationEntries = () => {
    if (activeUser == null) return [];
    const commands: Command[] = [];
    const basicNavigationEntries = [
      { name: "Tasks (Dashboard)", path: "/dashboard/tasks" },
      { name: "Annotations", path: "/dashboard/annotations" },
      { name: "Datasets", path: "/dashboard/datasets" },
      { name: "Time Tracking", path: "/timetracking" },
    ];

    const adminMenu = getAdministrationSubMenu(false, activeUser);
    const adminCommands: Array<{ name: string; path: string }> = [];
    adminMenu?.children.map((entry: { key: string }) => {
      adminCommands.push({ name: getLabelForPath(entry.key), path: entry.key });
    });

    const statisticsCommands = Utils.isUserAdminOrManager(activeUser)
      ? [
          {
            path: "/reports/projectProgress",
            name: "Project Progress",
          },
          {
            path: "/reports/availableTasks",
            name: "Available Tasks",
          },
        ]
      : [];

    const navigationEntries = [...basicNavigationEntries, ...adminCommands, ...statisticsCommands];

    navigationEntries.forEach((entry, counter) => {
      commands.push({
        id: counter,
        name: `Navigate to ${entry.name}`,
        command: () => {
          window.location.href = entry.path;
        },
        color: "#5660ff",
      });
    });

    return commands;
  };

  const getToolEntries = () => {
    if (!isInTracingView) return [];
    const commands: Command[] = [];
    let availableTools = Object.keys(AnnotationToolEnum) as [keyof typeof AnnotationToolEnum];
    if (isViewMode || !restrictions.allowUpdate) {
      availableTools = AvailableToolsInViewMode as [keyof typeof AnnotationToolEnum];
    }
    availableTools.forEach((tool, counter) => {
      commands.push({
        id: counter,
        name: `Switch to ${getLabelForTool(tool)} Tool`,
        command: () => Store.dispatch(setToolAction(tool)),
        color: "#5660ff",
      });
    });
    return commands;
  };

  const menuActions = getMenuActions(isViewMode);

  const allCommands = [
    ...getNavigationEntries(),
    ...getToolEntries(),
    ...mapMenuActionsToCommands(menuActions),
    ...getTabsAndSettingsMenuItems(),
  ];
  return (
    <div style={{ marginRight: "10px" }}>
      <ReactCommandPalette
        commands={allCommands.map((command, counter) => {
          return {
            ...command,
            id: counter,
          };
        })}
        hotKeys={["ctrl+k", "command+k"]}
        trigger={label}
        closeOnSelect
        resetInputOnOpen
        maxDisplayed={100}
        theme={theme === "light" ? commandPaletteLightTheme : commandPaletteDarkTheme}
      />
    </div>
  );
};
