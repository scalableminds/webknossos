/**
 * list_tree_view.js
 * @flow weak
 */

import _ from "lodash";
import React from "react";
import { connect } from "react-redux";
import { Button, Dropdown, Input, Menu } from "antd";
import Window from "libs/window";
import TreesTabItemView from "oxalis/view/right-menu/trees_tab_item_view";
import InputComponent from "oxalis/view/components/input_component";
import ButtonComponent from "oxalis/view/components/button_component";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setTreeNameAction,
  createTreeAction,
  deleteTreeAction,
  shuffleTreeColorAction,
  selectNextTreeAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import type { Dispatch } from "redux";
import Store from "oxalis/store";
import type { OxalisState } from "oxalis/store";

const ButtonGroup = Button.Group;
const InputGroup = Input.Group;

class TreesTabView extends React.Component {
  handleChangeTreeName = evt => {
    this.props.onChangeTreeName(evt.target.value);
  };

  deleteTree = () => {
    if (Window.confirm("Do you really want to delete the whole tree?")) {
      this.props.onDeleteTree();
    }
  };

  shuffleTreeColor = () => {
    getActiveTree(this.props.skeletonTracing).map(activeTree =>
      this.props.onShuffleTreeColor(activeTree.treeId),
    );
  };

  shuffleAllTreeColors = () => {
    for (const tree of _.values(this.props.skeletonTracing.trees)) {
      this.props.onShuffleTreeColor(tree.treeId);
    }
  };

  toggleAllTrees() {
    Store.dispatch(toggleAllTreesAction());
  }

  toggleInactiveTrees() {
    Store.dispatch(toggleInactiveTreesAction());
  }

  getTreesComponents() {
    const orderAttribute = this.props.userConfiguration.sortTreesByName ? "name" : "timestamp";

    return _.orderBy(this.props.skeletonTracing.trees, [orderAttribute], ["asc"]).map(tree =>
      <TreesTabItemView
        key={tree.treeId}
        tree={tree}
        activeTreeId={this.props.skeletonTracing.activeTreeId}
      />,
    );
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

  render() {
    const activeTreeName = getActiveTree(this.props.skeletonTracing)
      .map(activeTree => activeTree.name)
      .getOrElse("");

    return (
      <div id="tree-list" className="flex-column">
        <ButtonGroup>
          <ButtonComponent onClick={this.props.onCreateTree} title="Create Tree">
            <i className="fa fa-plus" /> Create
          </ButtonComponent>
          <ButtonComponent onClick={this.deleteTree} title="Delete Tree">
            <i className="fa fa-trash-o" /> Delete
          </ButtonComponent>
          <ButtonComponent onClick={this.shuffleTreeColor} title="Change Tree Color">
            <i className="fa fa-adjust" /> Change Color
          </ButtonComponent>
          <ButtonComponent onClick={this.shuffleAllTreeColors} title="Shuffle All Tree Colors">
            <i className="fa fa-random" /> Shuffle All Colors
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

        <ul className="flex-overflow">
          {this.getTreesComponents()}
        </ul>
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
    dispatch(deleteTreeAction());
  },
  onChangeTreeName(name) {
    dispatch(setTreeNameAction(name));
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(TreesTabView);
