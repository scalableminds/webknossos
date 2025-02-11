import type { MenuItemType } from "antd/lib/menu/interface";
import _ from "lodash";
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
      id: counter,
      color: "#5660ff",
    };
  });
};

export const WkCommandPalette = () => {
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [isUserScriptsModalOpen, setIsUserScriptsModalOpen] = useState(false);
  const [isZarrPrivateLinksModalOpen, setIsZarrPrivateLinksModalOpen] = useState(false); // TODO_c check the right default

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
  return (
    <div style={{ marginRight: "10px" }}>
      {modals}
      <CommandPalette
        commands={mapMenuActionsToCommands(menuItems)}
        hotKeys={["ctrl+k", "command+k"]}
        trigger="[Ctrl+K] Commands"
        closeOnSelect
        resetInputOnOpen
      />
    </div>
  );
};
