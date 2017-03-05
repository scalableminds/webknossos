import _ from "lodash";
import app from "app";
import Marionette from "backbone.marionette";
import SortTableBehavior from "libs/behaviors/sort_table_behavior";
import ProjectListItemView from "admin/views/project/project_list_item_view";

class ProjectListView extends Marionette.CompositeView {
  static initClass() {
    this.prototype.template = _.template(`\
<h3>Projects</h3>
<table class="table table-striped table-details sortable-table" id="projectlist-table">
  <thead>
    <tr>
      <th data-sort="name">Name</th>
      <th data-sort="team">Team</th>
      <th data-sort="priority">Priority</th>
      <th data-sort="location">Location</th>
      <th data-sort="owner.lastName">Owner</th>
      <th data-sort="numberOfOpenAssignments">Open Assignments</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody></tbody>
</table>
<div id="modal-wrapper"></div>\
`);

    this.prototype.className = "container wide project-administration";
    this.prototype.childView = ProjectListItemView;
    this.prototype.childViewContainer = "tbody";

    this.prototype.behaviors = {
      SortTableBehavior: {
        behaviorClass: SortTableBehavior,
      },
    };

    this.prototype.ui =
      { modalWrapper: "#modal-wrapper" };

    this.prototype.behaviors = {
      SortTableBehavior: {
        behaviorClass: SortTableBehavior,
      },
    };
  }


  initialize() {
    this.collection.fetch();
    this.collection.setSorting("priority", "desc");

    this.listenTo(app.vent, "paginationView:filter", this.filterBySearch);
    this.listenTo(app.vent, "modal:destroy", this.render);
    this.listenTo(app.vent, "paginationView:addElement", this.createProject);
  }


  filterBySearch(searchQuery) {
    return this.collection.setFilter(["name", "team", "priority", "location"], searchQuery);
  }


  createProject() {
    return app.router.navigate("/projects/create", { trigger: true });
  }
}
ProjectListView.initClass();

export default ProjectListView;
