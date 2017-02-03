/**
 * list_tree_item_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import Utils from "libs/utils";
import scrollIntoViewIfNeeded from "scroll-into-view-if-needed";

class ListTreeItemView extends Marionette.View {
  static initClass() {
    this.prototype.tagName = "li";
    this.prototype.template = _.template(`\
<i class="fa <%- getIcon() %>"></i>
<a href="#" data-treeid="<%- treeId %>">
  <span title="Node count" class="inline-block tree-node-count" style="width: 50px;"><%- nodes.length %></span>
  <i class="fa fa-circle tree-icon" style="color: #<%- intToHex(color) %>"></i>
  <span title="Tree Name" class="tree-name"><%- name %></span>
</a>\
`);

    this.prototype.events =
      { "click a": "setActive" };
  }

  templateContext() {
    return {
      getIcon: () => {
        if (this.model.get("treeId") === this.activeTreeId) {
          return "fa-angle-right";
        } else {
          return "fa-bull";
        }
      },

      intToHex: Utils.intToHex,
    };
  }


  initialize(options) {
    this.activeTreeId = options.activeTreeId;
    this.parent = options.parent;
  }


  setActive() {
    const id = this.model.get("treeId");
    this.parent.setActiveTree(id);
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
