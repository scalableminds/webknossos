import type { MenuItemType } from "antd/lib/menu/interface";
import _ from "lodash";
import { settings } from "messages";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { Store } from "oxalis/singletons";
import type { OxalisState } from "oxalis/store";
import { useState } from "react";
import type { Command } from "react-command-palette";
import CommandPalette from "react-command-palette";
import { useSelector } from "react-redux";
import {
  type TracingLayoutViewProps,
  getModalsAndMenuItems,
} from "../action-bar/tracing_actions_view";

const mapMenuActionsToCommands = (menuActions: MenuItemType[]): Command[] => {
  return menuActions?.map((action, counter) => {
    return {
      name: action?.title || action?.label?.toString() || "",
      command: action?.onClick || _.noop,
      color: "#5660ff",
      id: counter,
    };
  });
};

export const WkCommandPalette = () => {
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isUserScriptsModalOpen, setIsUserScriptsModalOpen] = useState(false);
  const [isZarrPrivateLinksModalOpen, setIsZarrPrivateLinksModalOpen] = useState(false); // TODO_c check the right default
  const userConfig = useSelector((state: OxalisState) => state.userConfiguration);

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

  const getTabsAndSettingsMenuItems = () => {
    return [
      {
        id: 1,
        name: `Toggle ${settings.displayCrosshair}` || "Toggle Display Crosshair",
        command: () =>
          Store.dispatch(updateUserSettingAction("displayCrosshair", !userConfig.displayCrosshair)),
        color: "#5660ff",
      },
    ];
  };

  const { menuItems, modals } = getModalsAndMenuItems(
    props,
    null,
    isMergeModalOpen,
    (newValue: boolean) => setIsMergeModalOpen(newValue),
    isUserScriptsModalOpen,
    (newValue: boolean) => setIsUserScriptsModalOpen(newValue),
    isZarrPrivateLinksModalOpen,
    (newValue: boolean) => setIsZarrPrivateLinksModalOpen(newValue),
  );

  const allCommands = [...mapMenuActionsToCommands(menuItems), ...getTabsAndSettingsMenuItems()];
  return (
    <div style={{ marginRight: "10px" }}>
      {modals}
      <CommandPalette
        commands={allCommands.map((command, counter) => {
          return {
            ...command,
            id: counter,
          };
        })}
        hotKeys={["ctrl+k", "command+k"]}
        trigger="[Ctrl+K] Commands"
        closeOnSelect
        resetInputOnOpen
      />
    </div>
  );
};
