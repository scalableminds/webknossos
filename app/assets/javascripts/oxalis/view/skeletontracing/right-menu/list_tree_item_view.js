/**
 * list_tree_item_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";
import Store from "oxalis/store";
import { setActiveTreeAction } from "oxalis/model/actions/skeletontracing_actions";

class ListTreeItemView extends Marionette.View {

  activeTreeId: number;

  static initClass() {
    this.prototype.tagName = "li";
    this.prototype.template = _.template(`\
<i class="fa <%- getIcon() %>"></i>
<a href="#" data-treeid="<%- treeId %>">
  <span title="Node count" class="inline-block tree-node-count" style="width: 50px;"><%- _.size(nodes) %></span>
  <i class="fa fa-circle tree-icon" style="color: rgb(<%- rgbToString() %>)"></i>
  <span title="Tree Name" class="tree-name"><%- name %></span>
</a>\
`);

    this.prototype.events =
      { "click a": "setActive" };
  }

  templateContext = function templateContext() {
    return {
      getIcon: () => {
        if (this.model.get("treeId") === this.activeTreeId) {
          return "fa-angle-right";
        } else {
          return "fa-bull";
        }
      },

      rgbToString: () => this.model.get("color").map(c => Math.round(c * 255)).join(","),
    };
  }


  initialize(options) {
    this.activeTreeId = options.activeTreeId;
  }


  setActive() {
    const id = this.model.get("treeId");
    Store.dispatch(setActiveTreeAction(id));
  }


  onRender() {
    // scroll to active tree
    if (this.model.get("treeId") === this.activeTreeId) {
      scrollIntoViewIfNeeded(this.el);
    }
  }
}
ListTreeItemView.initClass();

export default ListTreeItemView;
