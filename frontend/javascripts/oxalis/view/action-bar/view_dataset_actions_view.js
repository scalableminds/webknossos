// @flow
import * as React from "react";
import { Dropdown, Icon, Menu } from "antd";
import ButtonComponent from "oxalis/view/components/button_component";
import ShareViewDatasetModalView from "oxalis/view/action-bar/share_view_dataset_modal_view";

type Props = {
  layoutMenu: React.Node,
};
type State = {
  isShareDatasetModalOpen: boolean,
};

class ViewDatasetActionsView extends React.PureComponent<Props, State> {
  state = {
    isShareDatasetModalOpen: false,
  };

  handleOpenShareDatasetModal = () => {
    this.setState({ isShareDatasetModalOpen: true });
  };

  handleCloseShareDatasetModal = () => {
    this.setState({ isShareDatasetModalOpen: false });
  };

  render() {
    const modal = (
      <ShareViewDatasetModalView
        isVisible={this.state.isShareDatasetModalOpen}
        onOk={this.handleCloseShareDatasetModal}
      />
    );

    const overlayMenu = (
      <Menu>
        {this.props.layoutMenu}
        <Menu.Item key="share-button" onClick={this.handleOpenShareDatasetModal}>
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
}

export default ViewDatasetActionsView;
