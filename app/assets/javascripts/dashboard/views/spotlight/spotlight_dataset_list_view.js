import app from "app";
import Marionette from "backbone.marionette";
import SpotlightDatasetView from "./spotlight_dataset_view";

class SpotlightDatasetListView extends Marionette.CollectionView {
  static initClass() {
    this.prototype.childView = SpotlightDatasetView;
  }

  initialize() {
    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.collection.setSorting("created", "desc");
    return this.collection.setCollectionFilter(child => child.get("isActive"));
  }


  filterBySearch(searchQuery) {
    return this.collection.setFilter(["name", "owningTeam", "description"], searchQuery);
  }
}
SpotlightDatasetListView.initClass();

export default SpotlightDatasetListView;

