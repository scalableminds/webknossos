import _ from "lodash";
import React from "react";
import { Router, Route } from "react-router-dom";
import { Layout, LocaleProvider } from "antd";
import enUS from "antd/lib/locale-provider/en_US";

import app from "app";
import { SkeletonTracingTypeTracingEnum } from "oxalis/store";
import { ControlModeEnum } from "oxalis/constants";
import Navbar from "./navbar";

import TracingLayoutView from "oxalis/view/tracing_layout_view";
import DashboardView from "dashboard/views/dashboard_view";
import SpotlightView from "dashboard/views/spotlight_view";
import LoginView from "admin/views/auth/login_view";
import RegistrationView from "admin/views/auth/registration_view";
import StartResetPasswordView from "admin/views/auth/start_reset_password_view";
import FinishResetPasswordView from "admin/views/auth/finish_reset_password_view";
import ChangePasswordView from "admin/views/auth/change_password_view";
import DatasetImportView from "dashboard/views/dataset/dataset_import_view";

// admin
import FAQView from "admin/views/help/faq_view.js";
import KeyboardShortcutView from "admin/views/help/keyboardshortcut_view.js";
import PaginationView from "admin/views/pagination_view";
import DatasetAddView from "admin/views/dataset/dataset_add_view";
import UserListView from "admin/views/user/user_list_view";
import UserCollection from "admin/models/user/user_collection";
import TeamListView from "admin/views/team/team_list_view";
import TeamCollection from "admin/models/team/team_collection";
import TaskListView from "admin/views/task/task_list_view";
import TaskCollection from "admin/models/task/task_collection";
import TaskTypeListView from "admin/views/tasktype/task_type_list_view";
import TaskTypeCollection from "admin/models/tasktype/task_type_collection";
import ProjectListView from "admin/views/project/project_list_view";
import ProjectCollection from "admin/models/project/project_collection";
import StatisticView from "admin/views/statistic/statistic_view";
import WorkloadListView from "admin/views/workload/workload_list_view";
import WorkloadCollection from "admin/models/workload/workload_collection";
import ScriptListView from "admin/views/scripts/script_list_view";
import ScriptCollection from "admin/models/scripts/script_collection";
import ProjectCreateView from "admin/views/project/project_create_view";
import ProjectModel from "admin/models/project/project_model";
import ProjectEditView from "admin/views/project/project_edit_view";
import DatasetModel from "admin/models/dataset/dataset_model";
import TaskQueryView from "admin/views/task/task_query_view";
import TaskCreateView from "admin/views/task/task_create_view";
import TaskModel from "admin/models/task/task_model";
import TaskCreateFromView from "admin/views/task/task_create_subviews/task_create_from_view";
import TaskTypeCreateView from "admin/views/tasktype/task_type_create_view";
import TaskTypeModel from "admin/models/tasktype/task_type_model";
import ScriptCreateView from "admin/views/scripts/script_create_view";
import ScriptModel from "admin/models/scripts/script_model";
import TaskOverviewView from "admin/views/task/task_overview_view";
import TaskOverviewCollection from "admin/models/task/task_overview_collection";

import PaginationCollection from "admin/models/pagination_collection";

const { Content } = Layout;

class BackboneWrapper extends React.Component {
  state = {
    html: null,
  };

  componentDidMount() {
    this.container.appendChild(this.props.backboneView.render().el);
  }

  render() {
    return (
      <div key={this.props.backboneView.toString()}>
        <div ref={el => (this.container = el)} />
      </div>
    );
  }
}

class ReactRouter extends React.Component {
  showWithPagination = (View, Collection, options = {}) => {
    _.defaults(options, { addButtonText: null });

    const collection = new Collection(null, options);
    const paginatedCollection = new PaginationCollection([], { fullCollection: collection });
    const view = new View({ collection: paginatedCollection });
    const paginationView = new PaginationView({
      collection: paginatedCollection,
      addButtonText: options.addButtonText,
    });

    return (
      <div>
        <BackboneWrapper backboneView={paginationView} />
        <BackboneWrapper backboneView={view} />
      </div>
    );
  };

  projectTasks = ({ match }) => {
    return this.showWithPagination(TaskListView, TaskCollection, {
      projectName: match.params.projectName,
      addButtonText: "Create New Task",
    });
  };

  projectEdit = () => {
    const model = new TaskModel();
    const view = new TaskCreateView({ model });

    return <BackboneWrapper backboneView={view} />;
  };

  taskTypesCreate = () => {
    const model = new TaskModel();
    const view = new TaskCreateView({ model });

    return <BackboneWrapper backboneView={view} />;
  };

  taskTypesTasks = ({ match }) => {
    return this.showWithPagination(TaskListView, TaskCollection, {
      taskTypeId: match.params.taskTypeId,
      addButtonText: "Create New Task",
    });
  };

  taskOverview = () => {
    const collection = new TaskOverviewCollection();
    const view = new TaskOverviewView({ collection });

    return <BackboneWrapper backboneView={view} />;
  };

  workload = () => {
    return this.showWithPagination(WorkloadListView, WorkloadCollection);
  };

  taskQuery = () => {
    const view = new TaskQueryView();

    return <BackboneWrapper backboneView={view} />;
  };

  taskEdit = ({ match }) => {
    const model = new TaskModel({ id: match.params.taskId });
    const view = new TaskCreateFromView({ model, type: "from_form" });

    return <BackboneWrapper backboneView={view} />;
  };

  datasetAdd = () => {
    const model = new TaskModel();
    const view = new TaskCreateView({ model });

    return <BackboneWrapper backboneView={view} />;
  };

  taskCreate = () => {
    const view = new DatasetAddView();

    return <BackboneWrapper backboneView={view} />;
  };

  projectCreate = () => {
    const model = new ProjectModel();
    const view = new ProjectCreateView({ model });

    return <BackboneWrapper backboneView={view} />;
  };

  scriptsCreate = ({ match }) => {
    const id = match.params.id || null;
    const model = new ScriptModel({ id });
    const view = new ScriptCreateView({ model });
    return <BackboneWrapper backboneView={view} />;
  };

  tracingView({ match }) {
    return (
      <TracingLayoutView
        initialTracingType={match.params.type}
        initialTracingId={match.params.id}
        initialControlmode={ControlModeEnum.TRACE}
      />
    );
  }

  tracingViewPublic({ match }) {
    return (
      <TracingLayoutView
        initialTracingType={SkeletonTracingTypeTracingEnum.View}
        initialTracingId={match.params.id}
        initialControlmode={ControlModeEnum.VIEW}
      />
    );
  }

  render() {
    return (
      <Router history={app.history}>
        <LocaleProvider locale={enUS}>
          <Layout>
            <Navbar />
            <Content>
              <Route exact path="/" component={DashboardView} />
              <Route path="/dashboard" component={DashboardView} />

              <Route path="/users" component={UserListView} />
              <Route path="/teams" component={TeamListView} />
              <Route path="/statistics" component={StatisticView} />
              <Route path="/tasks" render={this.taskQuery} exact />
              <Route path="/tasks/create" render={this.taskCreate} />
              <Route path="/tasks/overview" render={this.taskOverview} />
              <Route path="/tasks/:taskId/edit" render={this.taskEdit} />
              <Route path="/projects" component={ProjectListView} exact />
              <Route path="/projects/create" render={this.projectCreate} />
              <Route path="/projects/:projectName/tasks" render={this.projectTasks} />
              <Route path="/projects/:id/edit" render={this.projectEdit} />
              <Route path="/annotations/:type/:id" render={this.tracingView} />
              <Route path="/annotations/:type/:id/readOnly)" render={this.tracingView} />
              <Route path="/datasets/:id/view" render={this.tracingViewPublic} />
              <Route path="/dashboard" component={DashboardView} />
              <Route path="/datasets" component={DashboardView} exact />
              <Route path="/datasets/upload" render={this.datasetAdd} />
              <Route
                path="/datasets/:datasetName/edit"
                component={DatasetImportView}
                isEditingMode={true}
              />
              <Route
                path="/datasets/:name/import"
                component={DatasetImportView}
                isEditingMode={true}
              />
              <Route path="/users/:id/details" component={DashboardView} />
              <Route path="/taskTypes" component={TaskTypeListView} exact />
              <Route path="/taskTypes/create" render={this.taskTypesCreate} />
              <Route path="/taskTypes/:id/edit" render={this.taskTypesCreate} />
              <Route path="/taskTypes/:taskTypeId/tasks" render={this.taskTypesTasks} />
              <Route path="/scripts/create" render={this.scriptsCreate} />
              <Route path="/scripts/:id/edit" render={this.scriptsCreate} />
              <Route path="/scripts" component={ScriptListView} exact />
              <Route path="/spotlight" component={SpotlightView} />
              <Route path="/workload" render={this.workload} />
              <Route path="/login" component={LoginView} />
              <Route path="/register" component={RegistrationView} />
              <Route path="/reset" component={StartResetPasswordView} />
              <Route path="/finishreset" component={FinishResetPasswordView} />
              <Route path="/api/changepassword" component={ChangePasswordView} />
              <Route path="/help/faq" component={FAQView} />
              <Route path="/help/keyboardshortcuts" component={KeyboardShortcutView} />
            </Content>
          </Layout>
        </LocaleProvider>
      </Router>
    );
  }
}

export default ReactRouter;
