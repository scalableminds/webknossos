import { getDatasets, getReadableAnnotations, updateSelectedThemeOfUser } from "admin/rest_api";
import type { ItemType } from "antd/lib/menu/interface";
import { formatHash } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { capitalize, getPhraseFromCamelCaseString } from "libs/utils";
import * as Utils from "libs/utils";
import _ from "lodash";
import { getAdministrationSubMenu } from "navbar";
import { useCallback, useMemo, useState } from "react";
import type { Command } from "react-command-palette";
import ReactCommandPalette from "react-command-palette";
import { getSystemColorTheme, getThemeFromUser } from "theme";
import { WkDevFlags } from "viewer/api/wk_dev";
import { ViewModeValues } from "viewer/constants";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { Toolkits } from "viewer/model/accessors/tool_accessor";
import { setViewModeAction, updateUserSettingAction } from "viewer/model/actions/settings_actions";
import { setThemeAction, setToolAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { Store } from "viewer/singletons";
import type { UserConfiguration } from "viewer/store";
import {
  type TracingViewMenuProps,
  useTracingViewMenuItems,
} from "../action-bar/use_tracing_view_menu_items";
import { viewDatasetMenu } from "../action-bar/view_dataset_actions_view";
import { LayoutEvents, layoutEmitter } from "../layouting/layout_persistence";
import { commandPaletteDarkTheme, commandPaletteLightTheme } from "./command_palette_theme";
type CommandWithoutId = Omit<Command, "id">;

const commandEntryColor = "#5660ff";

enum DynamicCommands {
  viewDataset = "> View Dataset...",
  viewAnnotation = "> View Annotation...",
}

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

//clean most html except <b> tags (for highlighting)
const cleanStringOfMostHTML = (dirtyString: string | undefined) =>
  dirtyString?.replace(/<(?!\/?b>)|[^<>\w\/ ]+/g, "");

export const CommandPalette = ({ label }: { label: string | JSX.Element | null }) => {
  console.log("Rendering Command Palette");

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

  const handleSelect = useCallback(async (command: Record<string, unknown>) => {
    console.log("h");
    if (typeof command === "string") {
      return;
    }

    if (command.name === DynamicCommands.viewDataset) {
      const items = await getDatasetItems();
      if (items.length > 0) {
        setCommands(items);
      } else {
        Toast.info("No datasets available.");
      }
      return;
    }

    if (command.name === DynamicCommands.viewAnnotation) {
      const items = await getAnnotationItems();
      if (items.length > 0) {
        setCommands(items);
      } else {
        Toast.info("No annotations available.");
      }
      return;
    }

    closePalette();
  }, []);

  const getDatasetItems = useCallback(async () => {
    const datasets = await getDatasets();
    return datasets.map((dataset) => ({
      name: `View dataset: ${dataset.name}`,
      command: () => {
        window.location.href = getViewDatasetURL(dataset);
      },
      color: commandEntryColor,
      id: dataset.id,
    }));
  }, []);

  const viewDatasetsItem = {
    name: DynamicCommands.viewDataset,
    command: () => {},
    color: commandEntryColor,
  };

  const getAnnotationItems = useCallback(async () => {
    const annotations = await getReadableAnnotations(false);
    const sortedAnnotations = _.sortBy(annotations, (a) => a.modified).reverse();
    return sortedAnnotations.map((annotation) => ({
      name: `View annotation: ${annotation.name.length > 0 ? annotation.name : formatHash(annotation.id)}`,
      command: () => {
        window.location.href = `/annotations/${annotation.id}`;
      },
      color: commandEntryColor,
      id: annotation.id,
    }));
  }, []);

  const viewAnnotationItems = {
    name: DynamicCommands.viewAnnotation,
    command: () => {},
    color: commandEntryColor,
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

  const getThemeEntries = () => {
    if (activeUser == null) return [];
    const commands: CommandWithoutId[] = [];

    const themesWithNames = [
      ["auto", "System-default"],
      ["light", "Light"],
      ["dark", "Dark"],
    ] as const;

    for (let [theme, name] of themesWithNames) {
      commands.push({
        name: `Switch to “${name}” color theme`,
        command: async () => {
          if (theme === "auto") theme = getSystemColorTheme();

          const newUser = await updateSelectedThemeOfUser(activeUser.id, theme);
          Store.dispatch(setThemeAction(theme));
          Store.dispatch(setActiveUserAction(newUser));
        },
        color: commandEntryColor,
      });
    }

    return commands;
  };

  const getViewModeEntries = () => {
    if (!isInTracingView) return [];
    const commands = ViewModeValues.map((mode) => ({
      name: `Switch to ${mode} mode`,
      command: () => {
        Store.dispatch(setViewModeAction(mode));
      },
      color: commandEntryColor,
    }));
    commands.push({
      name: "Reset layout",
      command: () => layoutEmitter.emit(LayoutEvents.resetLayout),
      color: commandEntryColor,
    });
    return commands;
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
        shortcut: shortCutDictForTools[tool.id] || "",
        color: commandEntryColor,
      });
    });
    return commands;
  };

  const tracingMenuItems = useTracingViewMenuItems(props, null);

  const menuActions = _.memoize(() => {
    if (!isInTracingView) return [];
    if (isViewMode) {
      return viewDatasetMenu;
    }
    return tracingMenuItems;
  });

  const allStaticCommands = _.memoize(() => [
    viewDatasetsItem,
    viewAnnotationItems,
    ...getNavigationEntries(),
    ...getThemeEntries(),
    ...getToolEntries(),
    ...getViewModeEntries(),
    ...mapMenuActionsToCommands(menuActions()),
    ...getTabsAndSettingsMenuItems(),
    ...getSuperUserItems(),
  ]);

  const [commands, setCommands] = useState<CommandWithoutId[]>(allStaticCommands);
  const [paletteKey, setPaletteKey] = useState(0);

  const closePalette = () => {
    setPaletteKey((prevKey) => prevKey + 1);
  };

  const commandsWithIds = useMemo(() => {
    return commands.map((command, index) => {
      return { id: index, ...command };
    });
  }, [commands]);

  return (
    <ReactCommandPalette
      commands={commandsWithIds}
      key={paletteKey}
      hotKeys={["ctrl+p", "command+p"]}
      trigger={label}
      maxDisplayed={100}
      theme={theme === "light" ? commandPaletteLightTheme : commandPaletteDarkTheme}
      onSelect={handleSelect}
      showSpinnerOnSelect={false}
      resetInputOnOpen
      onRequestClose={() => setCommands(allStaticCommands)}
      closeOnSelect={false}
      renderCommand={(command) => {
        const { name, shortcut, highlight: maybeDirtyString } = command;
        const cleanString = cleanStringOfMostHTML(maybeDirtyString);
        return (
          <div
            className="item"
            style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
          >
            {cleanString ? (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: modified from https://github.com/asabaylus/react-command-palette/blob/main/src/default-command.js
              <span dangerouslySetInnerHTML={{ __html: cleanString }} />
            ) : (
              <span>{name}</span>
            )}
            <span>{shortcut}</span>
          </div>
        );
      }}
    />
  );
};
