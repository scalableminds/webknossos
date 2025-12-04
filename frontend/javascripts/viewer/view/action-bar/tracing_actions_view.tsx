import {
  CheckOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  InfoCircleOutlined,
  LayoutOutlined,
  LinkOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { Button, Flex, Space, Tooltip } from "antd";
import type { SubMenuType } from "antd/es/menu/interface";
import messages from "messages";
import * as React from "react";
import type { LayoutKeys } from "viewer/view/layouting/default_layout_configs";
import { mapLayoutKeysToLanguage } from "viewer/view/layouting/default_layout_configs";
import ActionsMenu from "./actions_menu";
import SaveActions from "./save_actions";
import TaskCompletionActions from "./task_completion_actions";
import TracingModals from "./tracing_modals";

type Props = {
  layoutMenu: SubMenuType | null;
};

export type LayoutProps = {
  storedLayoutNamesForView: string[];
  activeLayout: string;
  layoutKey: LayoutKeys;
  autoSaveLayouts: boolean;
  setAutoSaveLayouts: (arg0: boolean) => void;
  setCurrentLayout: (arg0: string) => void;
  saveCurrentLayout: () => void;
};

type LayoutMenuProps = LayoutProps & {
  onResetLayout: () => void;
  onSelectLayout: (arg0: string) => void;
  onDeleteLayout: (arg0: string) => void;
  addNewLayout: () => void;
};

export function getLayoutMenu(props: LayoutMenuProps): SubMenuType {
  const {
    storedLayoutNamesForView,
    layoutKey,
    activeLayout,
    onResetLayout,
    onSelectLayout,
    onDeleteLayout,
    addNewLayout,
    autoSaveLayouts,
    setAutoSaveLayouts,
    saveCurrentLayout,
    // biome-ignore lint/correctness/noUnusedVariables: underscore prefix does not work with object destructuring
    setCurrentLayout,
  } = props;

  const layoutMissingHelpTitle = (
    <React.Fragment>
      <h5
        style={{
          color: "#fff",
        }}
      >
        Where is my layout?
      </h5>
      <p>{messages["layouting.missing_custom_layout_info"]}</p>
    </React.Fragment>
  );

  const customLayoutsItems = storedLayoutNamesForView.map((layout) => {
    const isSelectedLayout = layout === activeLayout;
    return {
      key: layout,
      className: isSelectedLayout
        ? "selected-layout-item bullet-point-less-li"
        : "bullet-point-less-li",
      label: (
        <div className="layout-dropdown-list-item-container">
          <div className="layout-dropdown-selection-area" onClick={() => onSelectLayout(layout)}>
            {layout}
          </div>
          {isSelectedLayout ? (
            <CheckOutlined className="sub-menu-item-icon" />
          ) : (
            <Tooltip placement="top" title="Remove this layout">
              <DeleteOutlined
                className="clickable-icon sub-menu-item-icon"
                onClick={() => onDeleteLayout(layout)}
              />
            </Tooltip>
          )}
        </div>
      ),
    };
  });

  return {
    key: "layout-menu",
    icon: <LayoutOutlined />,
    label: (
      <span
        style={{
          display: "inline-block",
          minWidth: 120,
        }}
      >
        Layout
        <Tooltip placement="top" title={layoutMissingHelpTitle}>
          <InfoCircleOutlined
            style={{
              color: "gray",
              marginRight: 36,
            }}
            className="right-floating-icon"
          />
        </Tooltip>
      </span>
    ),
    children: [
      {
        key: "layout-actions",
        type: "group",
        label: (
          <Flex
            justify="space-between"
            style={{
              padding: "0 16px",
            }}
            onKeyDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <Tooltip title="Add a new Layout">
              <Button
                type="text"
                icon={<PlusOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  addNewLayout();
                }}
              />
            </Tooltip>
            <Tooltip title="Reset Layout">
              <Button
                type="text"
                icon={<RollbackOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onResetLayout();
                }}
              />
            </Tooltip>
            <Tooltip
              title={`${autoSaveLayouts ? "Disable" : "Enable"} auto-saving of current layout`}
            >
              <Button
                type="text"
                icon={autoSaveLayouts ? <DisconnectOutlined /> : <LinkOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  setAutoSaveLayouts(!autoSaveLayouts);
                }}
              />
            </Tooltip>
            {!autoSaveLayouts && (
              <Tooltip title="Save current layout">
                <Button
                  type="text"
                  icon={<SaveOutlined />}
                  onClick={(e) => {
                    e.stopPropagation();
                    saveCurrentLayout();
                  }}
                />
              </Tooltip>
            )}
          </Flex>
        ),
      },
      { key: "divider", type: "divider" },
      {
        key: "available-layouts",
        type: "group",
        className: "available-layout-list",
        label: (
          <span
            style={{
              fontSize: 14,
            }}
          >{`Layouts for ${mapLayoutKeysToLanguage[layoutKey]}`}</span>
        ),
        children: customLayoutsItems,
      },
    ],
  };
}

function TracingActionsView({ layoutMenu }: Props) {
  return (
    <>
      <Space.Compact>
        <SaveActions />
        <TaskCompletionActions />
      </Space.Compact>
      <TracingModals />
      <ActionsMenu layoutMenu={layoutMenu} />
    </>
  );
}

export default TracingActionsView;
