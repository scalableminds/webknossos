import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import $ from "jquery";
import Marionette from "backbone.marionette";
import SortTableBehavior from "libs/behaviors/sort_table_behavior";
import DatasetListItemView from "./dataset_list_item_view";
import TeamAssignmentModalView from "./team_assignment_modal_view";

const DATASETS_PER_PAGE = 30;

class DatasetListView extends Marionette.CompositeView {

  static initClass() {
    this.prototype.className = "datasets";
    this.prototype.template = _.template(`\
<table class="table table-double-striped table-details sortable-table">
  <thead>
    <tr>
      <th class="details-toggle-all">
        <i class="caret-right"></i>
        <i class="caret-down"></i>
      </th>
      <th data-sort="dataSource.baseDir">Name</th>
      <th data-sort="created">Created</th>
      <th class="medium-column">Scale</th>
      <th>Allowed Teams</th>
      <th data-sort="isActive" class="small-column">Active</th>
      <th data-sort="isPublic" class="small-column">Public</th>
      <th>Data Layers</th>
      <th>Actions</th>
    </tr>
  </thead>
</table>
<div id="modal-wrapper"></div>\
`);


    this.prototype.events = {
      "click .team-label": "showModal",
      "click .details-toggle-all": "toggleAllDetails",
    };


    this.prototype.ui = {
      modalWrapper: "#modal-wrapper",
      detailsToggle: ".details-toggle-all",
    };

    this.prototype.childView = DatasetListItemView;
    this.prototype.childViewContainer = "table";

    this.prototype.behaviors = {
      SortTableBehavior: {
        behaviorClass: SortTableBehavior,
      },
    };
  }

  initialize() {
    this.collection.setSorting("created", "desc");
    this.collection.setCollectionFilter(child => child.get("isEditable"));
    this.collection.setPageSize(DATASETS_PER_PAGE);

    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "modal:destroy", this.render);
  }


  toggleAllDetails() {
    this.ui.detailsToggle.toggleClass("open");
    app.vent.trigger("datasetListView:toggleDetails");
  }


  showModal(evt) {
    const dataset = this.collection.findWhere({
      name: $(evt.target).closest("tbody").data("dataset-name"),
    });

    const modalView = new TeamAssignmentModalView({ dataset });
    modalView.render();
    this.ui.modalWrapper.html(modalView.el);
    modalView.$el.modal("show");
    this.modalView = modalView;
  }


  filterBySearch(searchQuery) {
    return this.collection.setFilter(["name", "owningTeam"], searchQuery);
  }


  onDestroy() {
    Utils.__guard__(this.modalView, x => x.destroy());
  }
}
DatasetListView.initClass();

export default DatasetListView;
