import type { ItemType } from "antd/lib/menu/interface";
import { capitalize } from "libs/utils";
import _ from "lodash";
import { getAdministrationSubMenu } from "navbar";
import { AnnotationToolEnum, AvailableToolsInViewMode } from "oxalis/constants";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setToolAction } from "oxalis/model/actions/ui_actions";
import { Store } from "oxalis/singletons";
import type { OxalisState, UserConfiguration } from "oxalis/store";
import { act, useState } from "react";
import type { Command } from "react-command-palette";
import ReactCommandPalette from "react-command-palette";
import { useSelector } from "react-redux";
import {
  type TracingLayoutViewProps,
  getModalsAndMenuItems,
} from "../action-bar/tracing_actions_view";
import { getViewDatasetMenu } from "../action-bar/view_dataset_actions_view";

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

const getLabelForUserConfigType = (key: string) =>
  key
    .split(/(?=[A-Z])/)
    .map((word) => capitalize(word))
    .join(" ");

const getLabelForPath = (key: string) => capitalize(key.split("/")[1]) || key;

const getLabelForTool = (tool: string) => {
  return tool
    .split("_")
    .map((word) => capitalize(word.toLowerCase()))
    .join(" ");
};

export const CommandPalette = ({ label }: { label: string | null }) => {
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isUserScriptsModalOpen, setIsUserScriptsModalOpen] = useState(false);
  const [isZarrPrivateLinksModalOpen, setIsZarrPrivateLinksModalOpen] = useState(false);
  const userConfig = useSelector((state: OxalisState) => state.userConfiguration);
  const isViewMode = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.controlMode === "VIEW",
  );
  const isInTracingView = useSelector(
    (state: OxalisState) => state.uiInformation.isInAnnotationView,
  );
  console.log("isInTracingView", isInTracingView);

  const props: TracingLayoutViewProps = useSelector((state: OxalisState) => {
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
    };
  });

  const { activeUser } = props;

  const getMenuActions = (isViewMode: boolean) => {
    if (!isInTracingView) return [];
    if (isViewMode) {
      const { items } = getViewDatasetMenu(null);
      return items;
    }
    const { menuItems } = getModalsAndMenuItems(
      props,
      null,
      isMergeModalOpen,
      (newValue: boolean) => setIsMergeModalOpen(newValue),
      isUserScriptsModalOpen,
      (newValue: boolean) => setIsUserScriptsModalOpen(newValue),
      isZarrPrivateLinksModalOpen,
      (newValue: boolean) => setIsZarrPrivateLinksModalOpen(newValue),
    );
    return menuItems;
  };

  const getTabsAndSettingsMenuItems = () => {
    const commands: Command[] = [];

    (Object.keys(userConfig) as [keyof UserConfiguration]).forEach((key, counter) => {
      if (typeof userConfig[key] === "boolean") {
        commands.push({
          id: counter,
          name: `Toggle ${getLabelForUserConfigType(key)}`,
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
      { name: "Tasks", path: "/dashboard/tasks" },
      { name: "Annotations", path: "/dashboard/annotations" },
      { name: "Datasets", path: "/dashboard/datasets" },
      { name: "Time Tracking", path: "/timetracking" },
    ];

    const adminEntries = getAdministrationSubMenu(false, activeUser);
    const adminCommands: Array<{ name: string; path: string }> = [];
    adminEntries?.children.map((entry: { key: string }) => {
      adminCommands.push({ name: getLabelForPath(entry.key), path: entry.key });
    });

    const navigationEntries = [...basicNavigationEntries, ...adminCommands];

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
    if (isViewMode) {
      availableTools = AvailableToolsInViewMode as [keyof typeof AnnotationToolEnum];
    }
    availableTools.forEach((tool, counter) => {
      commands.push({
        id: counter,
        name: `Switch to ${getLabelForTool(tool)} Tool`,
        command: () => {
          act(() => {
            Store.dispatch(setToolAction(tool));
          });
        },
        color: "#5660ff",
      });
    });
    return commands;
  };

  const menuActions = getMenuActions(isViewMode);

  const allCommands = [
    ...mapMenuActionsToCommands(menuActions),
    ...getTabsAndSettingsMenuItems(),
    ...getNavigationEntries(),
    ...getToolEntries(),
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
        trigger={label} //"[Ctrl+K] Commands"
        closeOnSelect
        resetInputOnOpen
      />
    </div>
  );
};
