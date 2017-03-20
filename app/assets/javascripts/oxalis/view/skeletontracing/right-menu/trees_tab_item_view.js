/**
 * list_tree_item_view.js
 * @flow
 */

import _ from "lodash";
import React from "react";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import Store from "oxalis/store";
import { setActiveTreeAction } from "oxalis/model/actions/skeletontracing_actions";
import type { TreeType } from "oxalis/store";

type ListTreeItemViewProps = {
  activeTreeId: number,
  tree: TreeType,
};

class ListTreeItemView extends React.PureComponent {

  props: ListTreeItemViewProps;

  handleSetActive = () => {
    Store.dispatch(setActiveTreeAction(this.props.tree.treeId));
  }

  scrollIntoView = (domElement: HTMLElement) => {
    // scroll to active tree
    if (domElement && this.props.tree.treeId === this.props.activeTreeId) {
      scrollIntoViewIfNeeded(domElement);
    }
  }

  render() {
    const iconClass = this.props.tree.treeId === this.props.activeTreeId ? "fa fa-angle-right" : "fa fa-bull";
    const rgbColorString = this.props.tree.color.map(c => Math.round(c * 255)).join(",");

    return (
      <li ref={this.scrollIntoView}>
        <i className={iconClass} />
        <a onClick={this.handleSetActive}>
          <span
            title="Node count"
            className="inline-block tree-node-count"
            style={{ width: 50 }}
          >
            { _.size(this.props.tree.nodes) }
          </span>
          <i
            style={{ color: `rgb(${rgbColorString})` }}
            className="fa fa-circle tree-icon"
          />
          <span title="Tree Name" className="tree-name">{ this.props.tree.name }</span>
        </a>
      </li>
    );
  }
}

export default ListTreeItemView;
