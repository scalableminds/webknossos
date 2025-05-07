import type { ItemType } from "antd/lib/menu/interface";
import { useWkSelector } from "libs/react_hooks";
import { capitalize, getPhraseFromCamelCaseString } from "libs/utils";
import * as Utils from "libs/utils";
import _ from "lodash";
import { getAdministrationSubMenu } from "navbar";
import { WkDevFlags } from "oxalis/api/wk_dev";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import { Toolkits } from "oxalis/model/accessors/tool_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { Store } from "oxalis/singletons";
import type { UserConfiguration } from "oxalis/store";
import type { Command } from "react-command-palette";
import ReactCommandPalette from "react-command-palette";
import { getThemeFromUser } from "theme";
import {
  type TracingViewMenuProps,
  getTracingViewMenuItems,
} from "../action-bar/tracing_actions_view";
import { viewDatasetMenu } from "../action-bar/view_dataset_actions_view";
import { commandPaletteDarkTheme, commandPaletteLightTheme } from "./command_palette_theme";

type CommandWithoutId = Omit<Command, "id">;

const commandEntryColor = "#5660ff";

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
  return _.compact(
    menuActions.map((action) => {
      if (action == null) {
        return null;
      }
      const onClickAction = "onClick" in action && action.onClick != null ? action.onClick : _.noop;
      return {
        name: getLabelForAction(action),
        command: onClickAction,
        color: commandEntryColor,
      };
    }),
  );
};

const getLabelForPath = (key: string) =>
  getPhraseFromCamelCaseString(capitalize(key.split("/")[1])) || key;

export const CommandPalette = ({ label }: { label: string | JSX.Element | null }) => {
  const userConfig = useWkSelector((state) => state.userConfiguration);
  const isViewMode = useWkSelector((state) => state.temporaryConfiguration.controlMode === "VIEW");
  const isInTracingView = useWkSelector((state) => state.uiInformation.isInAnnotationView);

  const restrictions = useWkSelector((state) => state.annotation.restrictions);
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

  const theme = getThemeFromUser(activeUser);

  const getMenuActions = (isViewMode: boolean) => {
    if (!isInTracingView) return [];
    if (isViewMode) {
      return viewDatasetMenu;
    }
    const menuItems = getTracingViewMenuItems(props, null);
    return menuItems;
  };

  const getTabsAndSettingsMenuItems = () => {
    if (!isInTracingView) return [];
    const commands: CommandWithoutId[] = [];

    (Object.keys(userConfig) as [keyof UserConfiguration]).forEach((key) => {
      if (typeof userConfig[key] === "boolean" && key !== "renderWatermark") {
        // removing the watermark is a paid feature
        commands.push({
          name: `Toggle ${getPhraseFromCamelCaseString(key)}`,
          command: () => Store.dispatch(updateUserSettingAction(key, !userConfig[key])),
          color: commandEntryColor,
        });
      }
    });
    return commands;
  };

  const getSuperUserItems = (): CommandWithoutId[] => {
    if (!activeUser?.isSuperUser) {
      return [];
    }
    return [
      {
        name: "Toggle Action Logging",
        command: () => (WkDevFlags.logActions = !WkDevFlags.logActions),
        color: commandEntryColor,
      },
    ];
  };

  const getNavigationEntries = () => {
    if (activeUser == null) return [];
    const commands: CommandWithoutId[] = [];
    const basicNavigationEntries = [
      { name: "Tasks (Dashboard)", path: "/dashboard/tasks" },
      { name: "Annotations", path: "/dashboard/annotations" },
      { name: "Datasets", path: "/dashboard/datasets" },
      { name: "Time Tracking", path: "/timetracking" },
    ];

    const adminMenu = getAdministrationSubMenu(false, activeUser);
    const adminCommands =
      adminMenu == null
        ? []
        : adminMenu.children.map((entry: { key: string }) => {
            return { name: getLabelForPath(entry.key), path: entry.key };
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

    navigationEntries.forEach((entry) => {
      commands.push({
        name: `Go to ${entry.name}`,
        command: () => {
          window.location.href = entry.path;
        },
        color: commandEntryColor,
      });
    });

    return commands;
  };

  const getToolEntries = () => {
    if (!isInTracingView) return [];
    const commands: CommandWithoutId[] = [];
    let availableTools = Object.values(AnnotationTool);
    if (isViewMode || !restrictions.allowUpdate) {
      availableTools = Toolkits.READ_ONLY_TOOLS;
    }
    availableTools.forEach((tool) => {
      commands.push({
        name: `Switch to ${tool.readableName}`,
        command: () => Store.dispatch(setToolAction(tool)),
        color: commandEntryColor,
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
    ...getSuperUserItems(),
  ];
  return (
    <ReactCommandPalette
      commands={allCommands.map((command, counter) => {
        return {
          ...command,
          id: counter,
        };
      })}
      hotKeys={["ctrl+p", "command+p"]}
      trigger={label}
      closeOnSelect
      resetInputOnOpen
      maxDisplayed={100}
      theme={theme === "light" ? commandPaletteLightTheme : commandPaletteDarkTheme}
    />
  );
};
