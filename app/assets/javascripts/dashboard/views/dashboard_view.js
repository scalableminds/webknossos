/**
 * dashboard_view.js
 * @flow weak
 */

import _ from "lodash";
import Marionette from "backbone.marionette";
import DashboardTaskListView from "dashboard/views/dashboard_task_list_view";
import ExplorativeTracingListView from "dashboard/views/explorative_tracing_list_view";
import LoggedTimeView from "dashboard/views/logged_time_view";
import DatasetSwitchView from "dashboard/views/dataset/dataset_switch_view";

class DashboardView extends Marionette.View {
  viewCache: Object;

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

    this.prototype.regions = { tabPane: ".tab-pane" };

    this.prototype.events = {
      "click #tab-datasets": "showDatasets",
      "click #tab-tasks": "showTasks",
      "click #tab-explorative": "showExplorative",
      "click #tab-logged-time": "showLoggedTime",
    };
  }

  // Cannot be ES6 style function, as these are covariant by default
  templateContext = function templateContext() {
    return { isAdminView: this.options.isAdminView };
  };

  initialize(options) {
    this.options = options;
    if (this.options.isAdminView) {
      this.listenTo(this, "render", this.showTasks);
    } else {
      const tabMethod = localStorage.getItem("lastUsedDashboardTab");
      // $FlowFixMe
      if (tabMethod && typeof this[tabMethod] === "function") {
        this.listenTo(this, "render", this[tabMethod]);

        setTimeout(() => {
          const mapping = {
            showDatasets: "#tab-datasets",
            showTasks: "#tab-tasks",
            showExplorative: "#tab-explorative",
            showLoggedTime: "#tab-logged-time",
          };

          this.$("li.active").removeClass("active");
          this.$(mapping[tabMethod]).parent().addClass("active");
        }, 100);
      } else {
        this.listenTo(this, "render", this.showDatasets);
      }
    }

    this.viewCache = {
      datasetSwitchView: null,
      taskListView: null,
      explorativeTracingListView: null,
      loggedTimeView: null,
    };
  }

  showDatasets() {
    this.saveLastTab("showDatasets");
    return this.showTab("datasetSwitchView", DatasetSwitchView);
  }

  showTasks() {
    this.saveLastTab("showTasks");
    return this.showTab("taskListView", DashboardTaskListView);
  }

  showExplorative() {
    this.saveLastTab("showExplorative");
    return this.showTab("explorativeTracingListView", ExplorativeTracingListView);
  }

  showLoggedTime() {
    this.saveLastTab("showLoggedTime");
    return this.showTab("loggedTimeView", LoggedTimeView);
  }

  saveLastTab(tabMethod) {
    if (!this.options.isAdminView) {
      localStorage.setItem("lastUsedDashboardTab", tabMethod);
    }
  }

  showTab(viewName, ViewClass) {
    let view = this.viewCache[viewName];
    if (!view) {
      view = new ViewClass(this.options);
      this.viewCache[viewName] = view;
    }
    return this.showChildView("tabPane", view, { preventDestroy: true });
  }
}
DashboardView.initClass();

export default DashboardView;
