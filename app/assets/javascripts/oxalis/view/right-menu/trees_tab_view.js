/**
 * list_tree_view.js
 * @flow
 */

import _ from "lodash";
import * as React from "react";
import { connect } from "react-redux";
import { Button, Dropdown, Input, Menu, Icon } from "antd";
import TreesTabItemView from "oxalis/view/right-menu/trees_tab_item_view";
import InputComponent from "oxalis/view/components/input_component";
import ButtonComponent from "oxalis/view/components/button_component";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { getActiveTree } from "oxalis/model/accessors/skeletontracing_accessor";
import {
  setTreeNameAction,
  createTreeAction,
  deleteTreeWithConfirmAction,
  shuffleTreeColorAction,
  shuffleAllTreeColorsAction,
  selectNextTreeAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import Store from "oxalis/store";
import { serializeToNml } from "oxalis/model/helpers/nml_helpers";
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

class TreesTabView extends React.PureComponent<Props> {
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

  exportAsNml = () => {
    const state = Store.getState();
    const nml = serializeToNml(state, this.props.skeletonTracing);
    const anchor = document.createElement("a");
    const objectUrl = URL.createObjectURL(new Blob([nml]));
    anchor.setAttribute("href", objectUrl);
    anchor.setAttribute("download", `${state.dataset.name}.nml`);

    if (document.createEvent) {
      const event = document.createEvent("MouseEvents");
      event.initEvent("click", true, true);
      anchor.dispatchEvent(event);
    } else {
      anchor.click();
    }
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
        <Menu.Item key="exportAsNml">
          <div onClick={this.exportAsNml} title="Export visible trees as nml">
            <Icon type="export" /> Export as Nml
          </div>
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
