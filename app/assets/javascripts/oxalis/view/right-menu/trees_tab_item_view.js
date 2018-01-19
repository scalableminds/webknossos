/**
 * list_tree_item_view.js
 * @flow
 */

import * as React from "react";
import { scrollIntoViewIfNeeded } from "scroll-into-view-if-needed";
import Store from "oxalis/store";
import {
  toggleTreeAction,
  setActiveTreeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import type { TreeType } from "oxalis/store";
import classNames from "classnames";
import Checkbox from "oxalis/view/components/checkbox_component";

type ListTreeItemViewProps = {
  activeTreeId: ?number,
  tree: TreeType,
};

class ListTreeItemView extends React.PureComponent<ListTreeItemViewProps> {
  domElement: HTMLElement;

  componentDidUpdate() {
    this.ensureVisible();
  }

  handleSetActive = () => {
    Store.dispatch(setActiveTreeAction(this.props.tree.treeId));
  };

  handleToggleTree = () => {
    Store.dispatch(toggleTreeAction(this.props.tree.treeId));
  };

  ensureVisible() {
    // scroll to active tree
    if (this.props.tree.treeId === this.props.activeTreeId) {
      scrollIntoViewIfNeeded(this.domElement, { centerIfNeeded: true });
    }
  }

  render() {
    const rgbColorString = this.props.tree.color.map(c => Math.round(c * 255)).join(",");
    const containsActiveNode = this.props.tree.treeId === this.props.activeTreeId;
    const aClassName = classNames({ bold: containsActiveNode });

    return (
      <li
        ref={domElement => {
          if (domElement) {
            this.domElement = domElement;
          }
        }}
      >
        <Checkbox
          checked={this.props.tree.isVisible}
          onChange={this.handleToggleTree}
          style={{ fontSize: 16 }}
        >
          {this.props.tree.nodes.size()}
        </Checkbox>

        <a onClick={this.handleSetActive} className={aClassName}>
          <i style={{ color: `rgb(${rgbColorString})` }} className="fa fa-circle tree-icon" />
          <span title="Tree Name" className="tree-name">
            {this.props.tree.name}
          </span>
        </a>
      </li>
    );
  }
}

export default ListTreeItemView;
