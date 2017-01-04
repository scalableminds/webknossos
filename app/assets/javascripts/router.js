// Remove these linting rules after refactoring
/*eslint global-require: "off", import/no-dynamic-require: "off", no-param-reassign: "off" */

import $ from "jquery";
import _ from "lodash";
import Backbone from "backbone";
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

    this.prototype.routes  = {
      "/users"                             : "users",
      "/teams"                             : "teams",
      "/statistics"                        : "statistics",
      "/tasks/create"                      : "taskCreate",
      "/tasks/:id/edit"                    : "taskEdit",
      "/projects"                          : "projects",
      "/projects/create"                   : "projectCreate",
      "/projects/:name/tasks"              : "projectTasks",
      "/projects/:id/edit"                 : "projectEdit",
      "/annotations/:type/:id(/readOnly)"  : "tracingView",
      "/datasets/:id/view"                 : "tracingViewPublic",
      "/dashboard"                         : "dashboard",
      "/datasets"                          : "dashboard",
      "/datasets/upload"                   : "datasetAdd",
      "/datasets/:id/edit"                 : "datasetEdit",
      "/users/:id/details"                 : "dashboard",
      "/taskTypes"                         : "taskTypes",
      "/taskTypes/create"                  : "taskTypesCreate",
      "/taskTypes/:id/edit"                : "taskTypesCreate",
      "/taskTypes/:id/tasks"               : "taskTypesTasks",
      "/spotlight"                         : "spotlight",
      "/tasks/overview"                    : "taskOverview",
      "/admin/taskTypes"                   : "hideLoadingSpinner",
      "/workload"                          : "workload",
      "/tasks"                             : "taskQuery"
    };
  }

  constructor(...args) {
    super(...args);
    this.dashboard = this.dashboard.bind(this);
    this.$loadingSpinner = $("#loader");
    this.$mainContainer = $("#main-container");
  }


  hideLoadingSpinner() {

    return this.$loadingSpinner.addClass("hidden");
  }


  tracingView(type, id) {

    return require(["oxalis/view/tracing_layout_view"], TracingLayoutView => {
      TracingLayoutView = TracingLayoutView.default;

      const view = new TracingLayoutView({
        tracingType: type,
        tracingId : id,
        controlMode : constants.CONTROL_MODE_TRACE
      });
      view.forcePageReload = true;
      return this.changeView(view);
    }
    );
  }


  tracingViewPublic(id) {

    return require(["oxalis/view/tracing_layout_view"], TracingLayoutView => {
      TracingLayoutView = TracingLayoutView.default;

      const view = new TracingLayoutView({
        tracingType: "View",
        tracingId : id,
        controlMode : constants.CONTROL_MODE_VIEW
      });
      view.forcePageReload = true;
      return this.changeView(view);
    }
    );
  }


  projects() {
    return this.showWithPagination("ProjectListView", "ProjectCollection", {addButtonText : "Create New Project"});
  }


  projectCreate() {
    return require(["admin/views/project/project_create_view", "admin/models/project/project_model"], (ProjectCreateView, ProjectModel) => {
      ProjectCreateView = ProjectCreateView.default;
      ProjectModel = ProjectModel.default;

      const model = new ProjectModel();
      const view = new ProjectCreateView({model});

      this.changeView(view);
      return this.hideLoadingSpinner();
    }
    );
  }


  projectEdit(projectName) {

    return require(["admin/views/project/project_edit_view", "admin/models/project/project_model"], (ProjectEditView, ProjectModel) => {
      ProjectEditView = ProjectEditView.default;
      ProjectModel = ProjectModel.default;

      const model = new ProjectModel({name : projectName});
      const view = new ProjectEditView({model});

      return this.listenTo(model, "sync", function() {
        this.changeView(view);
        return this.hideLoadingSpinner();
      });
    }
    );
  }


  statistics() {
    return this.showAdminView("StatisticView");
  }


  datasetAdd() {
    return this.showAdminView("DatasetAddView");
  }


  datasetEdit(datasetID) {
    return require(["admin/views/dataset/dataset_edit_view", "admin/models/dataset/dataset_model"], (DatasetEditView, DatasetModel) => {
      DatasetEditView = DatasetEditView.default;
      DatasetModel = DatasetModel.default;

      const model = new DatasetModel({name : datasetID});
      const view = new DatasetEditView({model});

      return this.listenTo(model, "sync", function() {
        this.changeView(view);
        return this.hideLoadingSpinner();
      });
    }
    );
  }


  users() {
    return this.showWithPagination("UserListView", "UserCollection", {});
  }


  teams() {
    return this.showWithPagination("TeamListView", "TeamCollection", {addButtonText : "Add New Team"});
  }


  taskQuery() {
    return require(["admin/views/task/task_query_view"], (TaskQueryView) => {
      TaskQueryView = TaskQueryView.default;

      const view = new TaskQueryView();
      return this.changeView(view);
    }
    );
  }


  projectTasks(projectName) {
     return this.showWithPagination("TaskListView", "TaskCollection", {projectName, addButtonText : "Create New Task"});
   }


  taskTypesTasks(taskTypeId) {
     return this.showWithPagination("TaskListView", "TaskCollection", {taskTypeId, addButtonText : "Create New Task"});
   }


  workload() {
    return this.showWithPagination("WorkloadListView", "WorkloadCollection");
  }


  taskTypes() {
    return this.showWithPagination("TaskTypeListView", "TaskTypeCollection", {addButtonText : "Create New TaskType"});
  }


  /**
   * Load layout view that shows task-creation subviews
   */
  taskCreate() {
    return require(["admin/views/task/task_create_view", "admin/models/task/task_model"], (TaskCreateView, TaskModel) => {
      TaskCreateView = TaskCreateView.default;
      TaskModel = TaskModel.default;

      const model = new TaskModel();
      const view = new TaskCreateView({model});

      this.changeView(view);
      return this.hideLoadingSpinner();
    }
    );
  }

  /**
   * Load item view which displays an editable task.
   */
  taskEdit(taskID) {

    return require(["admin/views/task/task_create_subviews/task_create_from_view", "admin/models/task/task_model"], (TaskCreateFromView, TaskModel) => {
      TaskCreateFromView = TaskCreateFromView.default;
      TaskModel = TaskModel.default;

      const model = new TaskModel({id : taskID});
      const view = new TaskCreateFromView({model, type : "from_form"});

      this.changeView(view);
      return this.hideLoadingSpinner();
    }
    );
  }


  taskTypesCreate(taskTypeId) {

    return require(["admin/views/tasktype/task_type_create_view", "admin/models/tasktype/task_type_model"], (TaskTypeCreateView, TaskTypeModel) => {
      TaskTypeCreateView = TaskTypeCreateView.default;
      TaskTypeModel = TaskTypeModel.default;

      const model = new TaskTypeModel({id : taskTypeId});
      const view = new TaskTypeCreateView({model});
      this.changeView(view);
      return this.hideLoadingSpinner();
    }
    );
  }


  dashboard(userID) {
    return require(["dashboard/views/dashboard_view", "dashboard/models/user_model"], (DashboardView, UserModel) => {
      DashboardView = DashboardView.default;
      UserModel = UserModel.default;

      const isAdminView = userID !== null;

      const model = new UserModel({id : userID});
      const view = new DashboardView({ model, isAdminView, userID});

      this.listenTo(model, "sync", function() {
        this.changeView(view);
        return this.hideLoadingSpinner();
      });

      return model.fetch();
    }
    );
  }


  spotlight() {
    return require(["dashboard/views/spotlight/spotlight_view", "admin/models/dataset/dataset_collection"], (SpotlightView, DatasetCollection) => {
      SpotlightView = SpotlightView.default;
      DatasetCollection = DatasetCollection.default;

      const collection = new DatasetCollection();
      const paginatedCollection = new PaginationCollection([], {fullCollection : collection});
      const view = new SpotlightView({collection: paginatedCollection});

      this.changeView(view);
      return this.listenTo(collection, "sync", this.hideLoadingSpinner);
    }
    );
  }


  taskOverview() {

    return require(["admin/views/task/task_overview_view", "admin/models/task/task_overview_collection"], (TaskOverviewView, TaskOverviewCollection) => {
      TaskOverviewView = TaskOverviewView.default;
      TaskOverviewCollection = TaskOverviewCollection.default;

      const collection = new TaskOverviewCollection();
      const view = new TaskOverviewView({collection});

      this.changeView(view);
      return this.listenTo(collection, "sync", this.hideLoadingSpinner);
    }
    );
  }


  showWithPagination(view, collection, options) {
    if (options == null) { options = {}; }
    _.defaults(options, {addButtonText : null});

    return require(["admin/admin"], admin => {
      collection = new admin[collection](null, options);
      const paginatedCollection = new PaginationCollection([], {fullCollection : collection});
      view = new admin[view]({collection : paginatedCollection});
      const paginationView = new admin.PaginationView({collection : paginatedCollection, addButtonText : options.addButtonText});

      this.changeView(paginationView, view);
      return this.listenTo(collection, "sync", () => this.hideLoadingSpinner());
    }
    );
  }


  showAdminView(view, collection) {
    return require(["admin/admin"], admin => {
      if (collection) {
        collection = new admin[collection]();
        view = new admin[view]({collection});
        this.listenTo(collection, "sync", () => this.hideLoadingSpinner());
      } else {
        view = new admin[view]();
        setTimeout((() => this.hideLoadingSpinner()), 200);
      }

      return this.changeView(view);
    }
    );
  }

  changeView(...views) {

    if (_.isEqual(this.activeViews, views)) {
      return;
    }

    this.$loadingSpinner.removeClass("hidden");

    // Add new views
    this.activeViews = views;
    for (let view of views) {
      this.$mainContainer.append(view.render().el);
    }

    // Google Analytics
    if (typeof ga !== 'undefined' && ga !== null) {
      ga("send", "pageview", location.pathname);
    }

  }
}
Router.initClass();


export default Router;
