import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import SortTableBehavior from "libs/behaviors/sort_table_behavior";
import WorkloadListItemView from "admin/views/workload/workload_list_item_view";

class WorkloadListView extends Marionette.CompositeView {
  static initClass() {
    // TODO: WORKLOAD CURRENTLY DISABLED DUE TO PERFORMANCE REASONS
    //  template : _.template("""
    //    <h3>Workload</h3>
    //      <table class="table table-striped sortable-table">
    //        <thead>
    //          <tr>
    //            <th data-sort="name">Name</th>
    //            <th>Teams</th>
    //            <th data-sort="projects">Projects</th>
    //            <th data-sort="availableTaskCount">Number of all assignable tasks</th>
    //          </tr>
    //        </thead>
    //        <tbody></tbody>
    //      </table>
    //  """)

    this.prototype.template = _.template(`\
<h3>Workload</h3>
<p>Disabled due to performance issues.</p>\
`);
    this.prototype.className = "workload-table container wide";
    this.prototype.childView = WorkloadListItemView;
    this.prototype.childViewContainer = "tbody";

    this.prototype.behaviors = {
      SortTableBehavior: {
        behaviorClass: SortTableBehavior,
      },
    };
  }

  initialize() {
    this.collection.fetch().then(() => this.collection.setSorting("availableTaskCount", 1));

    this.listenTo(app.vent, "paginationView:filter", this.filterByQuery);
  }

  filterByQuery(filterQuery) {
    return this.collection.setFilter(["name", "teams", "projects"], filterQuery);
  }
}
WorkloadListView.initClass();

export default WorkloadListView;
