import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import ScriptListItemView from "admin/views/scripts/script_list_item_view";

class ScriptListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.className = "container wide";
    this.prototype.childView = ScriptListItemView;
    this.prototype.childViewContainer = "tbody";
  }

  template = () =>
    _.template(`\
<h3>Scripts</h3>
<table class="table table-striped table-details">
  <thead>
    <tr>
      <th>#</th>
      <th>Name</th>
      <th>Owner</th>
      <th>Gist URL</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody></tbody>
</table>\
`);

  initialize() {
    this.collection.fetch();

    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "paginationView:addElement", this.createNewScript);
  }

  createNewScript() {
    return app.router.navigate("/scripts/create", { trigger: true });
  }

  filterBySearch(searchQuery) {
    return this.collection.setFilter(["name", "id"], searchQuery);
  }
}

ScriptListView.initClass();

export default ScriptListView;
