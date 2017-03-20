/**
 * list_tree_view.js
 * @flow weak
 */

import _ from "lodash";
import React from "react";
import Maybe from "data.maybe";
import { connect } from "react-redux";
import { Button, Dropdown, Input, Menu } from "antd";
import Window from "libs/window";
import TreesTabItemView from "oxalis/view/skeletontracing/right-menu/trees_tab_item_view";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setTreeNameAction, createTreeAction, deleteTreeAction, shuffleTreeColorAction, selectNextTreeAction } from "oxalis/model/actions/skeletontracing_actions";
import type { Dispatch } from "redux";
import type { OxalisState } from "oxalis/store";

const ButtonGroup = Button.Group;
const InputGroup = Input.Group;

class TreesTabView extends React.Component {

  handleChangeTreeName = (evt) => {
    this.props.onChangeTreeName(evt.target.value);
  }

  deleteTree = () => {
    if (Window.confirm("Do you really want to delete the whole tree?")) {
      this.props.onDeleteTree();
    }
  }

  shuffleTreeColor = () => {
    const { activeTreeId, trees } = this.props.skeletonTracing;
    this.props.onShuffleTreeColor(trees[activeTreeId].treeId);
  }

  shuffleAllTreeColors = () => {
    for (const tree of _.values(this.props.skeletonTracing.trees)) {
      this.props.onShuffleTreeColor(tree.treeId);
    }
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
    const activeMenuKey = this.props.userConfiguration.sortTreesByName ? "sortByName" : "sortByTime";

    return (
      <Menu defaultSelectedKeys={[activeMenuKey]} onSelect={this.handleDropdownClick}>
        <Menu.Item key="sortByName">by name</Menu.Item>
        <Menu.Item key="sortByTime">by creation time</Menu.Item>
      </Menu>
    );
  }

  render() {
    const { trees, activeTreeId } = this.props.skeletonTracing;
    const activeTreeMaybe = Maybe.Just(trees[activeTreeId]);
    const activeTreeName = activeTreeMaybe.map(activeTree => activeTree.name).getOrElse("");

    return (
      <div id="tree-list">
        <ButtonGroup>
          <Button onClick={this.props.onCreateTree}><i className="fa fa-plus" /> Create tree</Button>
          <Button onClick={this.deleteTree}><i className="fa fa-trash-o" /> Delete tree</Button>
          <Button onClick={this.shuffleTreeColor} title="Change color"><i className="fa fa-adjust" /> Change Color</Button>
          <Button onClick={this.shuffleAllTreeColors} title="Shuffle all Colors"><i className="fa fa-random" /> Shuffle All Colors</Button>
          <Dropdown overlay={this.getSettingsDropdown()}>
            <Button title="Sort"><i className="fa fa-sort-alpha-asc" />Sort</Button>
          </Dropdown>
        </ButtonGroup>
        <InputGroup compact>
          <Button onClick={this.props.onSelectNextTree.bind(this, false)}><i className="fa fa-arrow-left" /></Button>
          <Input
            onChange={this.handleChangeTreeName}
            value={activeTreeName}
            style={{ width: "70%" }}
          />
          <Button onClick={this.props.onSelectNextTree.bind(this, true)}><i className="fa fa-arrow-right" /></Button>
        </InputGroup>

        <ul>
          { this.getTreesComponents() }
        </ul>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  skeletonTracing: state.skeletonTracing,
  userConfiguration: state.userConfiguration,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  onShuffleTreeColor(treeId) { dispatch(shuffleTreeColorAction(treeId)); },
  onSortTree(shouldSortTreesByName) { dispatch(updateUserSettingAction("sortTreesByName", shouldSortTreesByName)); },
  onSelectNextTree(forward) { dispatch(selectNextTreeAction(forward)); },
  onCreateTree() { dispatch(createTreeAction()); },
  onDeleteTree() { dispatch(deleteTreeAction()); },
  onChangeTreeName(name) { dispatch(setTreeNameAction(name)); },
});

export default connect(mapStateToProps, mapDispatchToProps)(TreesTabView);
