// @flow
import React, { type Node } from "react";
import { Dropdown, Menu } from "antd";
import { ShareAltOutlined, DownOutlined, CameraOutlined } from "@ant-design/icons";
import ButtonComponent from "oxalis/view/components/button_component";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";
import { downloadScreenshot } from "oxalis/view/rendering_utils";
import { setShareModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";

type Props = {
  layoutMenu: Node,
};

export const screenshotMenuItem = (
  <Menu.Item key="screenshot-button" onClick={downloadScreenshot}>
    <CameraOutlined />
    Screenshot (Q)
  </Menu.Item>
);

export default function ViewDatasetActionsView(props: Props) {
  const modal = (
    <ShareViewDatasetModalView onOk={() => Store.dispatch(setShareModalVisibilityAction(false))} />
  );
  const overlayMenu = (
    <Menu>
      <Menu.Item
        key="share-button"
        onClick={() => Store.dispatch(setShareModalVisibilityAction(true))}
      >
        <ShareAltOutlined />
        Share
      </Menu.Item>
      {screenshotMenuItem}
      {props.layoutMenu}
    </Menu>
  );

  return (
    <div style={{ marginLeft: 10 }}>
      {modal}
      <Dropdown overlay={overlayMenu} trigger={["click"]}>
        <ButtonComponent style={{ padding: "0 10px" }}>
          <DownOutlined />
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}
