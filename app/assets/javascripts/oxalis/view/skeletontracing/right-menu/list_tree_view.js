import _ from "lodash";
import $ from "jquery";
import Utils from "libs/utils";
import Marionette from "backbone.marionette";
import Backbone from "backbone";
import ListTreeItemView from "./list_tree_item_view";

class ListTreeView extends Marionette.CompositeView {
  static initClass() {

    this.prototype.id = "tree-navbar";
    this.prototype.className = "flex-column";
    this.prototype.template = _.template(`\
<div>
  <div class="btn-group">
    <button class="btn btn-default" id="tree-create-button"><i class="fa fa-plus"></i>Create tree</button>
    <button class="btn btn-default" id="tree-delete-button"><i class="fa fa-trash-o"></i>Delete tree</button>
  </div>
  <div class="btn-group pull-right">
    <button class="btn btn-default" id="tree-color-shuffle" title="Change color"><i class="fa fa-adjust"></i>Change Color</button>
    <button class="btn btn-default" id="tree-color-shuffle-all" title="Shuffle all Colors"><i class="fa fa-random"></i>Shuffle Colors</button>
    <button class="btn btn-default dropdown-toggle" data-toggle="dropdown" id="tree-sort-button" title="Sort">
      <i class="fa fa-sort-alpha-asc"></i>
    </button>
    <ul class="dropdown-menu pull-right" id="tree-sort">
      <li>
        <a href="#" data-sort="name">by name
          <i class="fa fa-check" id="sort-name-icon"></i>
        </a>
      </li>
      <li>
        <a href="#" data-sort="time">by creation time
          <i class="fa fa-check" id= "sort-time-icon"></i>
        </a>
      </li>
    </ul>
  </div>
</div>
<div class="input-group">
  <span class="input-group-btn">
    <button class="btn btn-default" id="tree-prev-button"><i class="fa fa-arrow-left"></i></button>
  </span>
  <input name="name" id="tree-name-input" class="form-control" type="text" autocomplete="off">
  <span class="input-group-btn">
    <button class="btn btn-default" id="tree-next-button"><i class="fa fa-arrow-right"></i></button>
  </span>
</div>
<ul id="tree-list" class="flex-overflow"></ul>\
`);

    this.prototype.childView = ListTreeItemView;
    this.prototype.childViewContainer = "ul#tree-list";

    this.prototype.events = {
      "change #tree-name-input": "setTreeName",
      "click #tree-prev-button": "selectPreviousTree",
      "click #tree-next-button": "selectNextTree",
      "click #tree-create-button": "createNewTree",
      "click #tree-delete-button": "deleteTree",
      "click #tree-color-shuffle": "shuffleTreeColor",
      "click #tree-color-shuffle-all": "shuffleAllTreeColors",
      "click a[data-sort]": "sortTrees",
    };

    this.prototype.ui = {
      treeNameInput: "#tree-name-input",
      sortNameIcon: "#sort-name-icon",
      sortTimeIcon: "#sort-time-icon",
    };
  }
  childViewOptions() {
    return {
      parent: this,
      activeTreeId: this.getActiveTree().treeId,
    };
  }


  initialize() {
    this.collection = new Backbone.Collection();

    this.listenTo(this, "render", this.updateSortIndicator);
    this.listenTo(this, "render", this.refresh);

    this.listenTo(this.model.skeletonTracing, "deleteTree", this.refresh);
    this.listenTo(this.model.skeletonTracing, "mergeTree", this.refresh);
    this.listenTo(this.model.skeletonTracing, "newTree", this.refresh);
    this.listenTo(this.model.skeletonTracing, "newTreeName", this.updateTreeWithId);
    this.listenTo(this.model.skeletonTracing, "reloadTrees", this.refresh);
    this.listenTo(this.model.skeletonTracing, "deleteActiveNode", node => this.updateTreeWithId(node.treeId));
    this.listenTo(this.model.skeletonTracing, "newNode", (id, treeId) => this.updateTreeWithId(treeId));
    this.listenTo(this.model.skeletonTracing, "newTreeColor", this.updateTreeWithId);
    this.listenTo(this.model.skeletonTracing, "newActiveTree", this.refresh);
    return this.listenTo(this.model.skeletonTracing, "newActiveNode", this.updateName);
  }


  setTreeName(evt) {
    return this.model.skeletonTracing.setTreeName(evt.target.value);
  }


  selectPreviousTree() {
    return this.selectNextTree(false);
  }


  selectNextTree(next = true) {
    this.model.skeletonTracing.selectNextTree(next);
    this.model.skeletonTracing.centerActiveNode();
    return this.updateName();
  }


  createNewTree() {
    return this.model.skeletonTracing.createNewTree();
  }


  deleteTree() {
    return this.model.skeletonTracing.deleteTree(true);
  }


  shuffleTreeColor() {
    return this.model.skeletonTracing.shuffleTreeColor();
  }


  shuffleAllTreeColors() {
    return this.model.skeletonTracing.shuffleAllTreeColors();
  }


  sortTrees(evt) {
    evt.preventDefault();
    this.model.user.set("sortTreesByName", ($(evt.currentTarget).data("sort") === "name"));

    this.refresh();
    return this.updateSortIndicator();
  }


  updateTreeWithId(treeId) {
    // This method is used instead of refresh to avoid performance issues
    const $childView = this.$(`a[data-treeid='${treeId}']`);
    const tree = this.model.skeletonTracing.getTree(treeId);

    $childView.children(".tree-node-count").text(tree.nodes.length);
    $childView.children(".tree-icon").css("color", `#${Utils.intToHex(tree.color)}`);
    return $childView.children(".tree-name").text(tree.name);
  }


  updateSortIndicator() {
    const isSortedByName = this.model.user.get("sortTreesByName");
    this.ui.sortNameIcon.toggle(isSortedByName);
    return this.ui.sortTimeIcon.toggle(!isSortedByName);
  }


  getActiveTree() {
    return this.model.skeletonTracing.getTree();
  }


  refresh() {
    const trees = this.model.skeletonTracing.getTreesSorted();
    this.collection.reset(trees);

    return this.updateName();
  }


  updateName() {
    const { name } = this.getActiveTree();
    return this.ui.treeNameInput.val(name);
  }


  setActiveTree(treeId) {
    this.model.skeletonTracing.setActiveTree(treeId);
    return this.model.skeletonTracing.centerActiveNode();
  }
}
ListTreeView.initClass();


export default ListTreeView;
