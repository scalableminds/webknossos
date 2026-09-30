import { getUsersOrganizations } from "admin/api/organization";
import {
  getAuthToken,
  getDatasets,
  getReadableAnnotations,
  updateSelectedThemeOfUser,
} from "admin/rest_api";
import DOMPurify from "dompurify";
import { copyToClipboard } from "libs/clipboard";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { getPhraseFromCamelCaseString, isUserAdminOrManager } from "libs/utils";
import capitalize from "lodash-es/capitalize";
import sortBy from "lodash-es/sortBy";
import { getAdministrationSubMenu, getAnalysisSubMenu, switchTo } from "navbar";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import ReactCommandPalette, { type Command } from "react-command-palette";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";
import { ColorWKBlue, getSystemColorTheme, getThemeFromUser } from "theme";
import { WkDevFlags } from "viewer/api/wk_dev";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import { setThemeAction } from "viewer/model/actions/ui_actions";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { commandPaletteDarkTheme, commandPaletteLightTheme } from "./command_palette_theme";

// than a theme token.
export const commandEntryColor = ColorWKBlue;

type ExtendedCommand = Command & {
  shortcut?: string;
  highlight?: string;
};

export type CommandWithoutId = Omit<ExtendedCommand, "id">;

// The commands which are only available within the viewer. The viewer provides them itself (see
// CommandPaletteViewerCommands), because the palette is shown on every page and should not pull
// in the viewer's code, which is only loaded on demand.
let viewerCommands: CommandWithoutId[] = [];
const viewerCommandsListeners = new Set<() => void>();

export function setViewerCommands(commands: CommandWithoutId[]) {
  viewerCommands = commands;
  for (const listener of viewerCommandsListeners) {
    listener();
  }
}

function subscribeToViewerCommands(listener: () => void) {
  viewerCommandsListeners.add(listener);
  return () => {
    viewerCommandsListeners.delete(listener);
  };
}

const getViewerCommands = () => viewerCommands;

enum DynamicCommands {
  viewDataset = "View Dataset ",
  viewAnnotation = "View Annotation ",
  switchOrganization = "Switch Organization ",
}

const getLabelForPath = (key: string) =>
  getPhraseFromCamelCaseString(capitalize(key.split("/")[1])) || key;

const cleanStringOfMostHTML = (dirtyString: string | undefined) => {
  if (dirtyString == null) return null;
  return DOMPurify.sanitize(dirtyString, { ALLOWED_TAGS: ["b"] });
};

export const CommandPalette = () => {
  const dispatch = useDispatch();

  const activeUser = useWkSelector((state) => state.activeUser);
  const viewerCommands = useSyncExternalStore(subscribeToViewerCommands, getViewerCommands);

  const navigate = useNavigate();
  const [paletteKey, setPaletteKey] = useState(0);

  const theme = getThemeFromUser(activeUser);

  // type annotation due to the library
  const handleSelect = useCallback(async (command: Record<string, unknown>) => {
    if (command.name == null) {
      return;
    }

    if (command.name === DynamicCommands.viewDataset) {
      try {
        const items = await getDatasetItems();
        if (items.length > 0) {
          setCommands(items);
        } else {
          Toast.info("No datasets available.");
        }
      } catch (_e) {
        Toast.error("Failed to load datasets.");
      }
      return;
    }

    if (command.name === DynamicCommands.viewAnnotation) {
      try {
        const items = await getAnnotationItems();
        if (items.length > 0) {
          setCommands(items);
        } else {
          Toast.info("No annotations available.");
        }
      } catch (_e) {
        Toast.error("Failed to load annotations.");
      }
      return;
    }

    if (command.name === DynamicCommands.switchOrganization) {
      try {
        const organizations = await getOrganizationItems();
        if (organizations.length > 0) {
          setCommands(organizations);
        } else {
          Toast.info("No other organizations available.");
        }
      } catch (_e) {
        Toast.error("Failed to load organizations.");
      }
      return;
    }

    closePalette();
  }, []);

  const getDatasetItems = useCallback(async () => {
    const datasets = await getDatasets();
    return datasets.map((dataset) => ({
      name: `View Dataset: ${dataset.name} (id ${dataset.id})`,
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
    shortcut: "Enter to show list",
    color: commandEntryColor,
  };

  const getAnnotationItems = useCallback(async () => {
    const annotations = await getReadableAnnotations(false);
    const sortedAnnotations = sortBy(annotations, (a) => a.modified).reverse();
    return sortedAnnotations.map((annotation) => {
      return {
        name: `View Annotation: ${annotation.name.length > 0 ? `${annotation.name} (id ${annotation.id})` : annotation.id}`,
        command: () => {
          window.location.href = `/annotations/${annotation.id}`;
        },
        color: commandEntryColor,
        id: annotation.id,
      };
    });
  }, []);

  const viewAnnotationsItem = {
    name: DynamicCommands.viewAnnotation,
    shortcut: "Enter to show list",
    command: () => {},
    color: commandEntryColor,
  };

  const getOrganizationItems = useCallback(async () => {
    const organizations = await getUsersOrganizations();
    const otherOrganizations = organizations.filter((orga) => orga.id !== activeUser?.organization);
    return otherOrganizations.map((organization) => {
      return {
        name: `Switch to Organization: ${organization.name}`,
        command: async () => {
          await switchTo(organization);
        },
        color: commandEntryColor,
        id: organization.id,
      };
    });
  }, [activeUser?.organization]);

  const switchOrganizationItem = {
    name: DynamicCommands.switchOrganization,
    shortcut: "Enter to show list",
    command: () => {},
    color: commandEntryColor,
  };

  const getAuthCommands = () => {
    if (activeUser == null) return [];
    return [
      {
        name: "Copy Organization ID",
        command: async () => {
          await copyToClipboard(activeUser.organization, "organization ID");
        },
        color: commandEntryColor,
      },
      {
        name: "Copy Auth Token",
        command: async () => {
          try {
            const token = await getAuthToken();
            await copyToClipboard(token, "auth token");
          } catch (error) {
            Toast.error("Failed to fetch auth token. Please refresh the page to try again.");
            console.error("Failed to fetch auth token:", error);
          }
        },
        color: commandEntryColor,
      },
    ];
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

    const analysisSubMenu = getAnalysisSubMenu(true);
    const analysisCommands =
      analysisSubMenu != null
        ? analysisSubMenu.children.map((entry) => {
            return { name: getLabelForPath(entry.key), path: entry.key };
          })
        : [];

    const statisticsCommands = isUserAdminOrManager(activeUser)
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

    const navigationEntries = [
      ...basicNavigationEntries,
      ...adminCommands,
      ...analysisCommands,
      ...statisticsCommands,
    ];

    navigationEntries.forEach((entry) => {
      commands.push({
        name: `Go to ${entry.name}`,
        command: () => {
          navigate(entry.path);
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
          dispatch(setThemeAction(theme));
          dispatch(setActiveUserAction(newUser));
        },
        color: commandEntryColor,
      });
    }

    return commands;
  };

  const allStaticCommands = [
    viewDatasetsItem,
    viewAnnotationsItem,
    switchOrganizationItem,
    ...getNavigationEntries(),
    ...getThemeEntries(),
    ...viewerCommands,
    ...getSuperUserItems(),
    ...getAuthCommands(),
  ];

  const [commands, setCommands] = useState<CommandWithoutId[]>(allStaticCommands);

  // Rerun when the viewer's commands change. For example, the "Toggle …" commands close over the
  // current user configuration. Without updating them, they would repeatedly apply the value that
  // was current when the palette mounted instead of actually flipping it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see comment above
  useEffect(() => {
    setCommands(allStaticCommands);
  }, [viewerCommands]);

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
      trigger={null}
      maxDisplayed={100}
      theme={theme === "light" ? commandPaletteLightTheme : commandPaletteDarkTheme}
      onSelect={handleSelect}
      showSpinnerOnSelect={false}
      resetInputOnOpen
      onRequestClose={() => setCommands(allStaticCommands)}
      closeOnSelect={false}
      renderCommand={(command) => {
        const { shortcut, highlight: maybeDirtyString, name } = command as ExtendedCommand;
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
