import type { MenuItemType } from "antd/lib/menu/interface";
import _ from "lodash";
import type { Command } from "react-command-palette";
import CommandPalette from "react-command-palette";

const mapMenuActionsToCommands = (menuActions: MenuItemType[]): Command[] => {
  return menuActions.map((action, counter) => {
    return {
      name: action.title || action.label?.toString() || "",
      command: action.onClick || _.noop,
      id: counter,
      color: "#5660ff",
    };
  });
};

export const WkCommandPalette = () => {
  return (
    <CommandPalette
      commands={mapMenuActionsToCommands(menuItems)}
      hotKeys={["ctrl+shift+k", "command+shift+k"]}
      trigger="Command Palette"
      closeOnSelect
      resetInputOnOpen
    />
  );
};
