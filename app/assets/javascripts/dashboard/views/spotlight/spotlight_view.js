import _ from "lodash";
import Marionette from "backbone.marionette";
import PaginationView from "admin/views/pagination_view";
import CreditsView from "dashboard/views/spotlight/credits_view";
import SpotlightDatasetListView from "dashboard/views/spotlight/spotlight_dataset_list_view";

class SpotlightView extends Marionette.View {
  static initClass() {
    this.prototype.className = "spotlight-view";
    this.prototype.template = _.template(`\
<div class="container">
  <div id="oxalis-header">
    <img src="/assets/images/oxalis.svg">
    <div><p>webKnossos</p></div>
  </div>
  <div id="pagination"></div>
  <div id="datasets" class="container wide"></div>
</div>
<div id="credits"></div>\
`);

    this.prototype.regions = {
      pagination: "#pagination",
      credits: "#credits",
      datasets: "#datasets",
    };
  }


  initialize() {
    this.paginationView = new PaginationView({ collection: this.collection });
    this.spotlightDatasetListView = new SpotlightDatasetListView({ collection: this.collection });

    this.creditsView = new CreditsView();

    this.collection.fetch({ data: "isActive=true" });
    this.listenTo(this.collection, "sync", function () {
      this.listenTo(this, "render", this.show);
      return this.show();
    });
  }


  show() {
    this.showChildView("pagination", this.paginationView);
    this.showChildView("datasets", this.spotlightDatasetListView);
    return this.showChildView("credits", this.creditsView);
  }
}
SpotlightView.initClass();


export default SpotlightView;
