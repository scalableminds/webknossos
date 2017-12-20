/**
 * list_tree_view.js
 * @flow
 */

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Button, Dropdown, Input, Menu, Icon, Spin, Modal } from "antd";
import TreesTabItemView from "oxalis/view/right-menu/trees_tab_item_view";
import InputComponent from "oxalis/view/components/input_component";
import ButtonComponent from "oxalis/view/components/button_component";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setTreeNameAction,
  createTreeAction,
  addTreesAction,
  deleteTreeWithConfirmAction,
  shuffleTreeColorAction,
  shuffleAllTreeColorsAction,
  selectNextTreeAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import Store from "oxalis/store";
import { serializeToNml, getNmlName, parseNml } from "oxalis/model/helpers/nml_helpers";
import Utils from "libs/utils";
import FileUpload from "components/file_upload";
import { saveAs } from "file-saver";
import Toast from "libs/toast";
import type { Dispatch } from "redux";
import type { OxalisState, SkeletonTracingType, UserConfigurationType } from "oxalis/store";

const ButtonGroup = Button.Group;
const InputGroup = Input.Group;

type Props = {
  onShuffleTreeColor: number => void,
  onShuffleAllTreeColors: () => void,
  onSortTree: boolean => void,
  onSelectNextTreeForward: () => void,
  onSelectNextTreeBackward: () => void,
  onCreateTree: () => void,
  onDeleteTree: () => void,
  onChangeTreeName: string => void,
  skeletonTracing: SkeletonTracingType,
  userConfiguration: UserConfigurationType,
};

type State = {
  isUploading: boolean,
  isDownloading: boolean,
};

class TreesTabView extends React.PureComponent<Props, State> {
  state = {
    isUploading: false,
    isDownloading: false,
  };

  handleChangeTreeName = evt => {
    this.props.onChangeTreeName(evt.target.value);
  };

  deleteTree = () => {
    this.props.onDeleteTree();
  };

  shuffleTreeColor = () => {
    getActiveTree(this.props.skeletonTracing).map(activeTree =>
      this.props.onShuffleTreeColor(activeTree.treeId),
    );
  };

  shuffleAllTreeColors = () => {
    this.props.onShuffleAllTreeColors();
  };

  toggleAllTrees() {
    Store.dispatch(toggleAllTreesAction());
  }

  toggleInactiveTrees() {
    Store.dispatch(toggleInactiveTreesAction());
  }

  handleNMLDownload = async () => {
    await this.setState({ isDownloading: true });
    // Wait for the Modal to render
    await Utils.sleep(1000);
    const state = Store.getState();
    const nml = serializeToNml(state, this.props.skeletonTracing);
    this.setState({ isDownloading: false });

    const blob = new Blob([nml], { type: "text/plain;charset=utf-8" });
    saveAs(blob, getNmlName(state));
  };

  handleNMLUpload = async (nmlString: string) => {
    let trees;
    try {
      trees = await parseNml(nmlString);
    } catch (e) {
      Toast.error(e.message);
      this.setState({ isUploading: false });
      return;
    }
    Store.dispatch(addTreesAction(trees));
    this.setState({ isUploading: false });
  };

  getTreesComponents() {
    const orderAttribute = this.props.userConfiguration.sortTreesByName ? "name" : "timestamp";

    return _.orderBy(this.props.skeletonTracing.trees, [orderAttribute], ["asc"]).map(tree => (
      <TreesTabItemView
        key={tree.treeId}
        tree={tree}
        activeTreeId={this.props.skeletonTracing.activeTreeId}
      />
    ));
  }

  handleDropdownClick = ({ key }) => {
    const shouldSortTreesByName = key === "sortByName";
    this.props.onSortTree(shouldSortTreesByName);
  };

  getSettingsDropdown() {
    const activeMenuKey = this.props.userConfiguration.sortTreesByName
      ? "sortByName"
      : "sortByTime";

    return (
      <Menu defaultSelectedKeys={[activeMenuKey]} onSelect={this.handleDropdownClick}>
        <Menu.Item key="sortByName">by name</Menu.Item>
        <Menu.Item key="sortByTime">by creation time</Menu.Item>
      </Menu>
    );
  }

  getActionsDropdown() {
    return (
      <Menu>
        <Menu.Item key="shuffleTreeColor">
          <div onClick={this.shuffleTreeColor} title="Change Tree Color">
            <i className="fa fa-adjust" /> Change Color
          </div>
        </Menu.Item>
        <Menu.Item key="shuffleAllTreeColors">
          <div onClick={this.shuffleAllTreeColors} title="Shuffle All Tree Colors">
            <i className="fa fa-random" /> Shuffle All Colors
          </div>
        </Menu.Item>
        <Menu.Item key="handleNMLDownload">
          <div onClick={this.handleNMLDownload} title="Download visible trees as NML">
            <Icon type="export" /> Download as NML
          </div>
        </Menu.Item>
        <Menu.Item key="importNml">
          <FileUpload
            accept=".nml"
            multiple={false}
            name="nmlFile"
            showUploadList={false}
            onSuccess={this.handleNMLUpload}
            onUploading={() => this.setState({ isUploading: true })}
            onError={() => this.setState({ isUploading: false })}
          >
            <Icon type="upload" /> Import Nml
          </FileUpload>
        </Menu.Item>
      </Menu>
    );
  }

  render() {
    const activeTreeName = getActiveTree(this.props.skeletonTracing)
      .map(activeTree => activeTree.name)
      .getOrElse("");

    return (
      <div id="tree-list" className="flex-column">
        <Modal
          visible={this.state.isDownloading || this.state.isUploading}
          title={this.state.isDownloading ? "Preparing NML" : "Importing NML"}
          closable={false}
          footer={null}
          width={200}
          style={{ textAlign: "center" }}
        >
          <Spin />
        </Modal>
        <ButtonGroup>
          <ButtonComponent onClick={this.props.onCreateTree} title="Create Tree">
            <i className="fa fa-plus" /> Create
          </ButtonComponent>
          <ButtonComponent onClick={this.deleteTree} title="Delete Tree">
            <i className="fa fa-trash-o" /> Delete
          </ButtonComponent>
          <ButtonComponent onClick={this.toggleAllTrees} title="Toggle Visibility of All Trees">
            <i className="fa fa-toggle-on" /> Toggle All
          </ButtonComponent>
          <ButtonComponent
            onClick={this.toggleInactiveTrees}
            title="Toggle Visibility of Inactive Trees"
          >
            <i className="fa fa-toggle-off" /> Toggle Inactive
          </ButtonComponent>
          <Dropdown overlay={this.getActionsDropdown()}>
            <ButtonComponent>
              More<Icon type="down" />
            </ButtonComponent>
          </Dropdown>
        </ButtonGroup>
        <InputGroup compact>
          <ButtonComponent onClick={this.props.onSelectNextTreeBackward}>
            <i className="fa fa-arrow-left" />
          </ButtonComponent>
          <InputComponent
            onChange={this.handleChangeTreeName}
            value={activeTreeName}
            style={{ width: "60%" }}
          />
          <ButtonComponent onClick={this.props.onSelectNextTreeForward}>
            <i className="fa fa-arrow-right" />
          </ButtonComponent>
          <Dropdown overlay={this.getSettingsDropdown()}>
            <ButtonComponent title="Sort">
              <i className="fa fa-sort-alpha-asc" />
            </ButtonComponent>
          </Dropdown>
        </InputGroup>

        <ul className="flex-overflow">{this.getTreesComponents()}</ul>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  skeletonTracing: state.tracing,
  userConfiguration: state.userConfiguration,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onShuffleTreeColor(treeId) {
    dispatch(shuffleTreeColorAction(treeId));
  },
  onShuffleAllTreeColors() {
    dispatch(shuffleAllTreeColorsAction());
  },
  onSortTree(shouldSortTreesByName) {
    dispatch(updateUserSettingAction("sortTreesByName", shouldSortTreesByName));
  },
  onSelectNextTreeForward() {
    dispatch(selectNextTreeAction(true));
  },
  onSelectNextTreeBackward() {
    dispatch(selectNextTreeAction(false));
  },
  onCreateTree() {
    dispatch(createTreeAction());
  },
  onDeleteTree() {
    dispatch(deleteTreeWithConfirmAction());
  },
  onChangeTreeName(name) {
    dispatch(setTreeNameAction(name));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(TreesTabView);
