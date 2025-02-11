import type { MenuItemType } from "antd/lib/menu/interface";
import _ from "lodash";
import type { Command } from "react-command-palette";

export const mapMenuActionsToCommands = (menuActions: MenuItemType[]): Command[] => {
  return menuActions.map((action, counter) => {
    return {
      name: action.title || action.label?.toString() || "",
      command: action.onClick || _.noop,
      id: counter,
      color: "#5660ff",
    };
  });
};
