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
import UserModel from "dashboard/models/user_model";
import SpotlightView from "dashboard/views/spotlight/spotlight_view";
import DatasetImportView from "dashboard/views/dataset/dataset_import_view";
import DatasetCollection from "admin/models/dataset/dataset_collection";

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
      "/tasks/create": "taskCreate",
      "/tasks/:id/edit": "taskEdit",
      "/projects": "projects",
      "/projects/create": "projectCreate",
      "/projects/:name/tasks": "projectTasks",
      "/projects/:id/edit": "projectEdit",
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
      "/tasks/overview": "taskOverview",
      "/admin/taskTypes": "hideLoadingSpinner",
      "/workload": "workload",
      "/tasks": "taskQuery",
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
    this.showWithPagination("ProjectListView", "ProjectCollection", {
      addButtonText: "Create New Project",
    });
  }

  projectCreate() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const ProjectCreateView = admin.ProjectCreateView;
      const ProjectModel = admin.ProjectModel;

      const model = new ProjectModel();
      const view = new ProjectCreateView({ model });

      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  projectEdit(projectName) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const ProjectEditView = admin.ProjectEditView;
      const ProjectModel = admin.ProjectModel;

      const model = new ProjectModel({ name: projectName });
      const view = new ProjectEditView({ model });

      this.listenTo(model, "sync", () => {
        this.changeView(view);
        this.hideLoadingSpinner();
      });
    });
  }

  statistics() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const StatisticView = admin.StatisticView;
      const TimeStatisticModel = admin.TimeStatisticModel;

      const model = new TimeStatisticModel();
      const view = new StatisticView({ model });

      this.changeView(view);
      this.listenTo(model, "sync", () => this.hideLoadingSpinner());
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
      const view = new ReactBackboneWrapper(admin.UserListView);
      this.changeView(view);
    });
  }

  teams() {
    this.showWithPagination("TeamListView", "TeamCollection", { addButtonText: "Add New Team" });
  }

  taskQuery() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const TaskQueryView = admin.TaskQueryView;

      const view = new TaskQueryView();
      this.changeView(view);
    });
  }

  projectTasks(projectName) {
    this.showWithPagination("TaskListView", "TaskCollection", {
      projectName,
      addButtonText: "Create New Task",
    });
  }

  taskTypesTasks(taskTypeId) {
    this.showWithPagination("TaskListView", "TaskCollection", {
      taskTypeId,
      addButtonText: "Create New Task",
    });
  }

  workload() {
    this.showWithPagination("WorkloadListView", "WorkloadCollection");
  }

  taskTypes() {
    this.showWithPagination("TaskTypeListView", "TaskTypeCollection", {
      addButtonText: "Create New TaskType",
    });
  }

  scripts() {
    this.showWithPagination("ScriptListView", "ScriptCollection", {
      addButtonText: "Create New Script",
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
      const TaskTypeCreateView = admin.TaskTypeCreateView;
      const TaskTypeModel = admin.TaskTypeModel;

      const model = new TaskTypeModel({ id: taskTypeId });
      const view = new TaskTypeCreateView({ model });
      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  scriptsCreate(scriptId) {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const ScriptCreateView = admin.ScriptCreateView;
      const ScriptModel = admin.ScriptModel;

      const model = new ScriptModel({ id: scriptId });
      const view = new ScriptCreateView({ model });
      this.changeView(view);
      this.hideLoadingSpinner();
    });
  }

  dashboard(userID) {
    const isAdminView = userID !== null;

    const model = new UserModel({ id: userID });
    const view = new DashboardView({ model, isAdminView, userID });

    this.listenTo(model, "sync", () => {
      this.changeView(view);
      this.hideLoadingSpinner();
    });

    model.fetch();
  }

  spotlight() {
    const collection = new DatasetCollection();
    const paginatedCollection = new PaginationCollection([], { fullCollection: collection });
    const view = new SpotlightView({ collection: paginatedCollection });

    this.changeView(view);
    this.listenTo(collection, "sync", this.hideLoadingSpinner);
  }

  taskOverview() {
    import(/* webpackChunkName: "admin" */ "admin/admin").then(admin => {
      const TaskOverviewView = admin.TaskOverviewView;
      const TaskOverviewCollection = admin.TaskOverviewCollection;

      const collection = new TaskOverviewCollection();
      const view = new TaskOverviewView({ collection });

      this.changeView(view);
      this.listenTo(collection, "sync", this.hideLoadingSpinner);
    });
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
