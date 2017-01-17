/**
 * router.js
 * @flow weak
 */

// Remove these linting rules after refactoring
/* eslint-disable global-require, import/no-dynamic-require, no-param-reassign */

import $ from "jquery";
import _ from "lodash";
import constants from "oxalis/constants";
import BaseRouter from "libs/base_router";
import PaginationCollection from "admin/models/pagination_collection";

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
      "/datasets/:id/edit": "datasetEdit",
      "/users/:id/details": "dashboard",
      "/taskTypes": "taskTypes",
      "/taskTypes/create": "taskTypesCreate",
      "/taskTypes/:id/edit": "taskTypesCreate",
      "/taskTypes/:id/tasks": "taskTypesTasks",
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
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TracingLayoutView) => {
      TracingLayoutView = TracingLayoutView.default;

      const view = new TracingLayoutView({
        tracingType: type,
        tracingId: id,
        controlMode: constants.CONTROL_MODE_TRACE,
      });
      view.forcePageReload = true;
      this.changeView(view);
    };
    require(["oxalis/view/tracing_layout_view"], callback);
  }


  tracingViewPublic(id) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TracingLayoutView) => {
      TracingLayoutView = TracingLayoutView.default;

      const view = new TracingLayoutView({
        tracingType: "View",
        tracingId: id,
        controlMode: constants.CONTROL_MODE_VIEW,
      });
      view.forcePageReload = true;
      this.changeView(view);
    };
    require(["oxalis/view/tracing_layout_view"], callback);
  }


  projects() {
    this.showWithPagination("ProjectListView", "ProjectCollection", { addButtonText: "Create New Project" });
  }


  projectCreate() {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (ProjectCreateView, ProjectModel) => {
      ProjectCreateView = ProjectCreateView.default;
      ProjectModel = ProjectModel.default;

      const model = new ProjectModel();
      const view = new ProjectCreateView({ model });

      this.changeView(view);
      this.hideLoadingSpinner();
    };
    require(["admin/views/project/project_create_view", "admin/models/project/project_model"], callback);
  }


  projectEdit(projectName) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (ProjectEditView, ProjectModel) => {
      ProjectEditView = ProjectEditView.default;
      ProjectModel = ProjectModel.default;

      const model = new ProjectModel({ name: projectName });
      const view = new ProjectEditView({ model });

      this.listenTo(model, "sync", () => {
        this.changeView(view);
        this.hideLoadingSpinner();
      });
    };
    require(["admin/views/project/project_edit_view", "admin/models/project/project_model"], callback);
  }


  statistics() {
    this.showAdminView("StatisticView");
  }


  datasetAdd() {
    this.showAdminView("DatasetAddView");
  }


  datasetEdit(datasetID) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (DatasetEditView, DatasetModel) => {
      DatasetEditView = DatasetEditView.default;
      DatasetModel = DatasetModel.default;

      const model = new DatasetModel({ name: datasetID });
      const view = new DatasetEditView({ model });

      this.listenTo(model, "sync", () => {
        this.changeView(view);
        this.hideLoadingSpinner();
      });
    };
    require(["admin/views/dataset/dataset_edit_view", "admin/models/dataset/dataset_model"], callback);
  }


  users() {
    this.showWithPagination("UserListView", "UserCollection", {});
  }


  teams() {
    this.showWithPagination("TeamListView", "TeamCollection", { addButtonText: "Add New Team" });
  }


  taskQuery() {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TaskQueryView) => {
      TaskQueryView = TaskQueryView.default;

      const view = new TaskQueryView();
      this.changeView(view);
    };
    require(["admin/views/task/task_query_view"], callback);
  }


  projectTasks(projectName) {
    this.showWithPagination("TaskListView", "TaskCollection", { projectName, addButtonText: "Create New Task" });
  }


  taskTypesTasks(taskTypeId) {
    this.showWithPagination("TaskListView", "TaskCollection", { taskTypeId, addButtonText: "Create New Task" });
  }


  workload() {
    this.showWithPagination("WorkloadListView", "WorkloadCollection");
  }


  taskTypes() {
    this.showWithPagination("TaskTypeListView", "TaskTypeCollection", { addButtonText: "Create New TaskType" });
  }


  /**
   * Load layout view that shows task-creation subviews
   */
  taskCreate() {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TaskCreateView, TaskModel) => {
      TaskCreateView = TaskCreateView.default;
      TaskModel = TaskModel.default;

      const model = new TaskModel();
      const view = new TaskCreateView({ model });

      this.changeView(view);
      this.hideLoadingSpinner();
    };
    require(["admin/views/task/task_create_view", "admin/models/task/task_model"], callback);
  }

  /**
   * Load item view which displays an editable task.
   */
  taskEdit(taskID) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TaskCreateFromView, TaskModel) => {
      TaskCreateFromView = TaskCreateFromView.default;
      TaskModel = TaskModel.default;

      const model = new TaskModel({ id: taskID });
      const view = new TaskCreateFromView({ model, type: "from_form" });

      this.changeView(view);
      this.hideLoadingSpinner();
    };
    require(["admin/views/task/task_create_subviews/task_create_from_view", "admin/models/task/task_model"], callback);
  }


  taskTypesCreate(taskTypeId) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TaskTypeCreateView, TaskTypeModel) => {
      TaskTypeCreateView = TaskTypeCreateView.default;
      TaskTypeModel = TaskTypeModel.default;

      const model = new TaskTypeModel({ id: taskTypeId });
      const view = new TaskTypeCreateView({ model });
      this.changeView(view);
      this.hideLoadingSpinner();
    };
    require(["admin/views/tasktype/task_type_create_view", "admin/models/tasktype/task_type_model"], callback);
  }


  dashboard(userID) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (DashboardView, UserModel) => {
      DashboardView = DashboardView.default;
      UserModel = UserModel.default;

      const isAdminView = userID !== null;

      const model = new UserModel({ id: userID });
      const view = new DashboardView({ model, isAdminView, userID });

      this.listenTo(model, "sync", () => {
        this.changeView(view);
        this.hideLoadingSpinner();
      });

      model.fetch();
    };
    require(["dashboard/views/dashboard_view", "dashboard/models/user_model"], callback);
  }


  spotlight() {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (SpotlightView, DatasetCollection) => {
      SpotlightView = SpotlightView.default;
      DatasetCollection = DatasetCollection.default;

      const collection = new DatasetCollection();
      const paginatedCollection = new PaginationCollection([], { fullCollection: collection });
      const view = new SpotlightView({ collection: paginatedCollection });

      this.changeView(view);
      this.listenTo(collection, "sync", this.hideLoadingSpinner);
    };
    require(["dashboard/views/spotlight/spotlight_view", "admin/models/dataset/dataset_collection"], callback);
  }


  taskOverview() {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (TaskOverviewView, TaskOverviewCollection) => {
      TaskOverviewView = TaskOverviewView.default;
      TaskOverviewCollection = TaskOverviewCollection.default;

      const collection = new TaskOverviewCollection();
      const view = new TaskOverviewView({ collection });

      this.changeView(view);
      this.listenTo(collection, "sync", this.hideLoadingSpinner);
    };
    require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_collection"], callback);
  }


  showWithPagination(view, collection, options = {}) {
    _.defaults(options, { addButtonText: null });

    // Webpack `require` doesn't work with inline arrow functions
    const callback = (admin) => {
      collection = new admin[collection](null, options);
      const paginatedCollection = new PaginationCollection([], { fullCollection: collection });
      view = new admin[view]({ collection: paginatedCollection });
      const paginationView = new admin.PaginationView({ collection: paginatedCollection, addButtonText: options.addButtonText });

      this.changeView(paginationView, view);
      this.listenTo(collection, "sync", () => this.hideLoadingSpinner());
    };
    require(["admin/admin"], callback);
  }


  showAdminView(view, collection) {
    // Webpack `require` doesn't work with inline arrow functions
    const callback = (admin) => {
      if (collection) {
        collection = new admin[collection]();
        view = new admin[view]({ collection });
        this.listenTo(collection, "sync", () => this.hideLoadingSpinner());
      } else {
        view = new admin[view]();
        setTimeout((() => this.hideLoadingSpinner()), 200);
      }

      this.changeView(view);
    };
    require(["admin/admin"], callback);
  }

  changeView(...views) {
    if (_.isEqual(this.activeViews, views)) {
      return;
    }

    this.hideLoadingSpinner();

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
