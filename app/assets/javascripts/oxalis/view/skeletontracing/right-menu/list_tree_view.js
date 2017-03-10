/**
 * list_tree_view.js
 * @flow weak
 */

import _ from "lodash";
import $ from "jquery";
import Marionette from "backbone.marionette";
import Backbone from "backbone";
import Store from "oxalis/store";
import Window from "libs/window";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { setActiveTreeAction, setTreeNameAction, createTreeAction, deleteTreeAction, shuffleTreeColorAction, selectNextTreeAction } from "oxalis/model/actions/skeletontracing_actions";
import ListTreeItemView from "oxalis/view/skeletontracing/right-menu/list_tree_item_view";

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
  childViewOptions = function childViewOptions() {
    return {
      activeTreeId: this.getActiveTreeId(),
    };
  }


  initialize() {
    // If you know how to do this better, do it. Backbones Collection type is not compatible to Marionettes
    // Collection type according to flow - although they actually should be...
    this.collection = ((new Backbone.Collection(): any): Marionette.Collection);

    this.listenTo(this, "render", this.updateSortIndicator);
    this.listenTo(this, "render", this.refresh);

    // Probably performance issues here
    // TODO Reactify this view
    Store.subscribe(() => this.refresh());
  }


  setTreeName(evt) {
    Store.dispatch(setTreeNameAction(evt.target.value));
  }


  selectPreviousTree() {
    this.selectNextTree(false);
  }


  selectNextTree(forward = true) {
    Store.dispatch(selectNextTreeAction(forward));
    this.updateName();
  }


  createNewTree() {
    Store.dispatch(createTreeAction());
  }


  deleteTree() {
    if (Window.confirm("Do you really want to delete the whole tree?")) {
      Store.dispatch(deleteTreeAction());
    }
  }


  shuffleTreeColor() {
    const { activeTreeId, trees } = Store.getState().skeletonTracing;
    Store.dispatch(shuffleTreeColorAction(trees[activeTreeId].treeId));
  }


  shuffleAllTreeColors() {
    for (const tree of _.values(Store.getState().skeletonTracing.trees)) {
      Store.dispatch(shuffleTreeColorAction(tree.treeId));
    }
  }


  sortTrees(evt) {
    evt.preventDefault();
    const shouldSortTreesByName = $(evt.currentTarget).data("sort") === "name";
    Store.dispatch(updateUserSettingAction("sortTreesByName", shouldSortTreesByName));

    this.refresh();
    this.updateSortIndicator();
  }

  updateSortIndicator() {
    const isSortedByName = Store.getState().userConfiguration.sortTreesByName;
    this.ui.sortNameIcon.toggle(isSortedByName);
    this.ui.sortTimeIcon.toggle(!isSortedByName);
  }


  getActiveTreeId() {
    return Store.getState().skeletonTracing.activeTreeId;
  }


  refresh() {
    const trees = _.values(Store.getState().skeletonTracing.trees);
    this.collection.reset(trees);

    this.updateName();
  }


  updateName() {
    const treeId = this.getActiveTreeId();
    const name = Store.getState().skeletonTracing.trees[treeId].name;
    this.ui.treeNameInput.val(name);
  }


  setActiveTree(treeId) {
    Store.dispatch(setActiveTreeAction(treeId));
  }
}
ListTreeView.initClass();


export default ListTreeView;
