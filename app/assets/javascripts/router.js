/**
 * router.js
 * @flow weak
 */

// Remove these linting rules after refactoring
/* eslint-disable global-require, import/no-dynamic-require, no-param-reassign */

import $ from "jquery";
import _ from "lodash";
import { ControlModeEnum } from "oxalis/constants";
import { SkeletonTracingTypeTracingEnum } from "oxalis/store";
import BaseRouter from "libs/base_router";
import ReactBackboneWrapper from "libs/react_backbone_wrapper";
import PaginationCollection from "admin/models/pagination_collection";

import TracingLayoutView from "oxalis/view/tracing_layout_view";
import DashboardView from "dashboard/views/dashboard_view";

import SpotlightView from "dashboard/views/spotlight_view";
import DatasetImportView from "dashboard/views/dataset/dataset_import_view";

// #####
// This Router contains all the routes for views that have been
// refactored to Backbone.View yet. All other routes, that require HTML to be
// delivered by the Server are handled by the NonBackboneRouter.
// #####
class Router extends BaseRouter {
  static initClass() {
    this.prototype.routes = {
      "/users": "users",
      "/teams": "teams",
      "/statistics": "statistics",
      "/tasks": "tasks",
      "/tasks/create": "taskCreate",
      "/tasks/:id/edit": "taskEdit",
      "/projects": "projects",
      "/projects/create": "projectCreate",
      "/projects/:name/tasks": "projectTasks",
      "/projects/:id/edit": "projectCreate",
      "/annotations/:type/:id(/readOnly)": "tracingView",
      "/datasets/:id/view": "tracingViewPublic",
      "/dashboard": "dashboard",
      "/datasets": "dashboard",
      "/datasets/upload": "datasetAdd",
      "/datasets/:name/edit": "datasetEdit",
      "/datasets/:name/import": "datasetImport",
      "/users/:id/details": "dashboard",
      "/taskTypes": "taskTypes",
      "/taskTypes/create": "taskTypesCreate",
      "/taskTypes/:id/edit": "taskTypesCreate",
      "/taskTypes/:id/tasks": "taskTypesTasks",
      "/scripts": "scripts",
      "/scripts/create": "scriptsCreate",
      "/scripts/:id/edit": "scriptsCreate",
      "/spotlight": "spotlight",
    };
  }

  constructor(...args) {
    super(...args);
    this.$loadingSpinner = $("#loader");
    this.$mainContainer = $("#main-container");
    this.initialize();
  }

  showLoadingSpinner() {
    this.$loadingSpinner.removeClass("hidden");
  }

  hideLoadingSpinner() {
    this.$loadingSpinner.addClass("hidden");
  }

  tracingView(type, id) {
    const view = new ReactBackboneWrapper(TracingLayoutView, {
      initialTracingType: type,
      initialTracingId: id,
      initialControlmode: ControlModeEnum.TRACE,
    });
    view.forcePageReload = true;
    this.changeView(view);
  }

  tracingViewPublic(id) {
    const view = new ReactBackboneWrapper(TracingLayoutView, {
      initialTracingType: SkeletonTracingTypeTracingEnum.View,
      initialTracingId: id,
      initialControlmode: ControlModeEnum.VIEW,
    });
    view.forcePageReload = true;
    this.changeView(view);
  }

  projects() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.ProjectListView, {});
      this.changeView(view);
    });
  }

  projectCreate(projectName) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.ProjectCreateView, { projectName });
      this.changeView(view);
    });
  }

  statistics() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.StatisticView, {});
      this.changeView(view);
    });
  }

  datasetAdd() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const DatasetAddView = admin.DatasetAddView;

      const view = new DatasetAddView();

      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  datasetEdit(name) {
    const view = new ReactBackboneWrapper(DatasetImportView, {
      datasetName: name,
      isEditingMode: true,
    });
    this.changeView(view);
  }

  datasetImport(name) {
    const view = new ReactBackboneWrapper(DatasetImportView, {
      datasetName: name,
      isEditingMode: false,
    });
    this.changeView(view);
  }

  users() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.UserListView, {});
      this.changeView(view);
    });
  }

  teams() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.TeamListView, {});
      this.changeView(view);
    });
  }

  tasks() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.TaskListView, {});
      this.changeView(view);
    });
  }

  projectTasks(projectName) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.TaskListView, {
        // See format for `mapPropsToFields`
        // https://ant.design/components/form/#Form.create(options)
        initialFieldValues: { projectName },
      });
      this.changeView(view);
    });
  }

  taskTypesTasks(taskTypeId) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.TaskListView, {
        // See format for `mapPropsToFields`
        // https://ant.design/components/form/#Form.create(options)
        initialFieldValues: { taskTypeId },
      });
      this.changeView(view);
    });
  }

  taskTypes() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.TaskTypeListView, {});
      this.changeView(view);
    });
  }

  scripts() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.ScriptListView, {});
      this.changeView(view);
    });
  }

  /**
   * Load layout view that shows task-creation subviews
   */
  taskCreate() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const TaskCreateView = admin.TaskCreateView;
      const TaskModel = admin.TaskModel;

      const model = new TaskModel();
      const view = new TaskCreateView({ model });

      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  /**
   * Load item view which displays an editable task.
   */
  taskEdit(taskID) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const TaskCreateFromView = admin.TaskCreateFromView;
      const TaskModel = admin.TaskModel;

      const model = new TaskModel({ id: taskID });
      const view = new TaskCreateFromView({ model, type: "from_form" });

      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  taskTypesCreate(taskTypeId) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.TaskTypeCreateView, { taskTypeId });
      this.changeView(view);
    });
  }

  scriptsCreate(scriptId) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const view = new ReactBackboneWrapper(admin.ScriptCreateView, { scriptId });
      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  dashboard(userID) {
    const isAdminView = userID !== null;
    const view = new ReactBackboneWrapper(DashboardView, {
      userID,
      isAdminView,
    });
    this.changeView(view);
  }

  spotlight() {
    const view = new ReactBackboneWrapper(SpotlightView, {});
    this.changeView(view);
  }

  showWithPagination(view, collection, options = {}) {
    _.defaults(options, { addButtonText: null });

    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      collection = new admin[collection](null, options);
      const paginatedCollection = new PaginationCollection([], { fullCollection: collection });
      view = new admin[view]({ collection: paginatedCollection });
      const paginationView = new admin.PaginationView({
        collection: paginatedCollection,
        addButtonText: options.addButtonText,
      });

      this.changeView(paginationView, view);
      this.listenTo(collection, "sync", () => this.hideLoadingSpinner());
    });
  }

  changeView(...views) {
    if (_.isEqual(this.activeViews, views)) {
      return;
    }

    // Add new views
    this.activeViews = views;
    for (const view of views) {
      this.$mainContainer.append(view.render().el);
    }

    // Google Analytics
    if (typeof window.ga !== "undefined" && window.ga !== null) {
      window.ga("send", "pageview", location.pathname);
    }
  }
}
Router.initClass();

export default Router;
