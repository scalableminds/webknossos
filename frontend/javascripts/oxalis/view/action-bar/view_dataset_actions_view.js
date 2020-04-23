// @flow
import React, { useState, type Node } from "react";
import { Dropdown, Icon, Menu } from "antd";
import ButtonComponent from "oxalis/view/components/button_component";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";

type Props = {
  layoutMenu: Node,
};

export default function ViewDatasetActionsView(props: Props) {
  const [shareDatasetModalVisibility, setShareDatasetModalVisibility] = useState(false);
  const modal = (
    <ShareViewDatasetModalView
      isVisible={shareDatasetModalVisibility}
      onOk={() => setShareDatasetModalVisibility(false)}
    />
  );
  const overlayMenu = (
    <Menu>
      {props.layoutMenu}
      <Menu.Item key="share-button" onClick={() => setShareDatasetModalVisibility(true)}>
        <Icon type="share-alt" />
        Share
      </Menu.Item>
    </Menu>
  );

  return (
    <div style={{ marginLeft: 10 }}>
      {modal}
      <Dropdown overlay={overlayMenu} trigger={["click"]}>
        <ButtonComponent style={{ padding: "0 10px" }}>
          <Icon type="down" />
        </ButtonComponent>
      </Dropdown>
    </div>
  );
}
