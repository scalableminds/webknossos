import _ from "lodash";
import Marionette from "backbone.marionette";
import DashboardTaskListView from "./dashboard_task_list_view";
import ExplorativeTracingListView from "./explorative_tracing_list_view";
import LoggedTimeView from "./logged_time_view";
import DatasetSwitchView from "./dataset/dataset_switch_view";


class DashboardView extends Marionette.View {
  static initClass() {
    this.prototype.className = "container wide";
    this.prototype.id = "dashboard";
    this.prototype.template = _.template(`\
<% if (isAdminView) { %>
  <h3>User: <%- firstName %> <%- lastName %></h3>
<% } %>
<div class="tabbable" id="tabbable-dashboard">
  <ul class="nav nav-tabs">
    <% if (!isAdminView) { %>
      <li class="active">
        <a href="#" id="tab-datasets" data-target="#placeholder" data-toggle="tab">Datasets</a>
      </li>
    <% } %>
    <li <% if (isAdminView) { %> class="active" <% } %> >
      <a href="#" id="tab-tasks" data-target="#placeholder" data-toggle="tab">Tasks</a>
    <li <% if (isAdminView) { %> class="active" <% } %> >
    </li>
    <li>
      <a href="#" id="tab-explorative" data-target="#placeholder" data-toggle="tab">Explorative Annotations</a>
    </li>
    <% if (isAdminView) { %>
      <li>
        <a href="#" id="tab-logged-time" data-target="#placeholder" data-toggle="tab">Tracked Time</a>
      </li>
    <% } %>
  </ul>
  <div class="tab-content">
    <div class="tab-pane active" id="placeholder"></div>
  </div>
</div>\
`);

    this.prototype.regions =
      { tabPane: ".tab-pane" };


    this.prototype.events = {
      "click #tab-datasets": "showDatasets",
      "click #tab-tasks": "showTasks",
      "click #tab-explorative": "showExplorative",
      "click #tab-logged-time": "showLoggedTime",
    };
  }


  templateContext() {
    return { isAdminView: this.options.isAdminView };
  }


  initialize(options) {
    this.options = options;
    if (this.options.isAdminView) {
      this.listenTo(this, "render", this.showTasks);
    } else {
      this.listenTo(this, "render", this.showDatasets);
    }

    return this.viewCache = {
      datasetSwitchView: null,
      taskListView: null,
      explorativeTracingListView: null,
      loggedTimeView: null,
    };
  }


  showDatasets() {
    return this.showTab("datasetSwitchView", DatasetSwitchView);
  }


  showTasks() {
    return this.showTab("taskListView", DashboardTaskListView);
  }


  showExplorative() {
    return this.showTab("explorativeTracingListView", ExplorativeTracingListView);
  }


  showLoggedTime() {
    return this.showTab("loggedTimeView", LoggedTimeView);
  }


  showTab(viewName, viewClass) {
    let view;
    if (!(view = this.viewCache[viewName])) {
      view = this.viewCache[viewName] = new viewClass(this.options);
    }
    return this.showChildView("tabPane", view, { preventDestroy: true });
  }
}
DashboardView.initClass();


export default DashboardView;
