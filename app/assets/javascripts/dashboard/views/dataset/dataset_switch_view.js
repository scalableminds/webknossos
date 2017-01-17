/**
 * dataset_switch_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import Utils from "libs/utils";
import DatasetCollection from "admin/models/dataset/dataset_collection";
import PaginationCollection from "admin/models/pagination_collection";
import PaginationView from "admin/views/pagination_view";
import DatasetListView from "./dataset_list_view";
import SpotlightDatasetListView from "../spotlight/spotlight_dataset_list_view";

class DatasetSwitchView extends Marionette.View {
  static initClass() {
    this.prototype.template = _.template(`\
<div class="pull-right">
  <% if(isAdmin) { %>
    <a href="/datasets/upload" class="btn btn-primary">
      <i class="fa fa-plus"></i>Add Dataset
    </a>
    <a href="#" id="showAdvancedView" class="btn btn-default">
      <i class="fa fa-th-list"></i>Show advanced view
    </a>
    <a href="#" id="showGalleryView" class="btn btn-default">
      <i class="fa fa-th"></i>Show gallery view
    </a>
  <% } %>
</div>

<h3>Datasets</h3>
<div class="pagination-region"></div>
<div class="dataset-region"></div>\
`);

    this.prototype.ui = {
      showAdvancedButton: "#showAdvancedView",
      showGalleryButton: "#showGalleryView",
    };

    this.prototype.events = {
      "click @ui.showAdvancedButton": "showAdvancedView",
      "click @ui.showGalleryButton": "showGalleryView",
    };

    this.prototype.regions = {
      datasetPane: ".dataset-region",
      pagination: ".pagination-region",
    };
  }


  templateContext() {
    return { isAdmin: Utils.isUserAdmin(this.model) };
  }


  initialize() {
    const datasetCollection = new DatasetCollection();
    this.collection = new PaginationCollection([], { fullCollection: datasetCollection });

    this.listenToOnce(this, "render", () => this.toggleSwitchButtons(true));
    this.listenToOnce(this.collection, "sync", function () {
      this.listenTo(this, "render", this.showGalleryView);
      return this.showGalleryView();
    });

    return this.collection.fetch();
  }


  toggleSwitchButtons(state) {
    this.ui.showGalleryButton.toggleClass("hide", state);
    return this.ui.showAdvancedButton.toggleClass("hide", !state);
  }


  showGalleryView() {
    this.toggleSwitchButtons(true);
    return this.showPaginatedDatasetView(SpotlightDatasetListView);
  }


  showAdvancedView() {
    this.toggleSwitchButtons(false);
    return this.showPaginatedDatasetView(DatasetListView);
  }


  showPaginatedDatasetView(DatasetView) {
    const collection = this.collection.clone();
    this.showChildView("datasetPane", new DatasetView({ collection }));
    return this.showChildView("pagination", new PaginationView({ collection }));
  }
}
DatasetSwitchView.initClass();


export default DatasetSwitchView;
