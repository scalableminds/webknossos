// @flow
import _ from "lodash";
import React from "react";
import { Router, Route, Redirect } from "react-router-dom";
import { connect } from "react-redux";
import { Layout, LocaleProvider } from "antd";
import enUS from "antd/lib/locale-provider/en_US";

import app from "app";
import { SkeletonTracingTypeTracingEnum } from "oxalis/store";
import { ControlModeEnum } from "oxalis/constants";
import Navbar from "navbar";
import BackboneWrapper from "libs/backbone_wrapper";

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
import FAQView from "admin/views/help/faq_view";
import KeyboardShortcutView from "admin/views/help/keyboardshortcut_view";
import PaginationView from "admin/views/pagination_view";
import DatasetAddView from "admin/views/dataset/dataset_add_view";
import UserListView from "admin/views/user/user_list_view";
import TeamListView from "admin/views/team/team_list_view";
import TaskListView from "admin/views/task/task_list_view";
import TaskCollection from "admin/models/task/task_collection";
import TaskTypeListView from "admin/views/tasktype/task_type_list_view";
import ProjectListView from "admin/views/project/project_list_view";
import StatisticView from "admin/views/statistic/statistic_view";
import WorkloadListView from "admin/views/workload/workload_list_view";
import WorkloadCollection from "admin/models/workload/workload_collection";
import ScriptListView from "admin/views/scripts/script_list_view";
import ProjectCreateView from "admin/views/project/project_create_view";
import ProjectModel from "admin/models/project/project_model";
import TaskQueryView from "admin/views/task/task_query_view";
import TaskCreateView from "admin/views/task/task_create_view";
import TaskModel from "admin/models/task/task_model";
import TaskCreateFromView from "admin/views/task/task_create_subviews/task_create_from_view";
import ScriptCreateView from "admin/views/scripts/script_create_view";
import ScriptModel from "admin/models/scripts/script_model";
import TaskOverviewView from "admin/views/task/task_overview_view";
import TaskOverviewCollection from "admin/models/task/task_overview_collection";
import PaginationCollection from "admin/models/pagination_collection";

import type { OxalisState } from "oxalis/store";

const { Content } = Layout;

type BrowserLocationType = {
  key: string,
  pathname: string,
  search: string,
  hash: string,
  state: Object,
};

type ReactRouterArgumentsType = {
  location: BrowserLocationType,
  match: {
    params: { [string]: string },
    isExact: boolean,
    path: string,
    url: string,
  },
  history: {
    length: number,
    action: string,
    location: BrowserLocationType,
    pathname: string,
    search: string,
    hash: string,
    state: string,
    push: (string, [Object]) => void,
    replace: (string, [Object]) => void,
    go: number => void,
    goBack: () => void,
    goForward: () => void,
    block: string => string,
  },
};

const SecuredRoute = ({ component: Component, render, isAuthenticated, ...rest }: Object) => (
  <Route
    {...rest}
    render={props =>
      isAuthenticated ? Component ? (
        <Component {...props} />
      ) : (
        render()
      ) : (
        <Redirect
          to={{
            pathname: "/login",
            state: { from: props.location },
          }}
        />
      )}
  />
);

class ReactRouter extends React.Component<*> {
  showWithPagination = (View: any, Collection: any, options: Object = {}) => {
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

  projectTasks = ({ match }: ReactRouterArgumentsType) =>
    this.showWithPagination(TaskListView, TaskCollection, {
      projectName: match.params.projectName,
      addButtonText: "Create New Task",
    });

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

  taskTypesTasks = ({ match }: ReactRouterArgumentsType) =>
    this.showWithPagination(TaskListView, TaskCollection, {
      taskTypeId: match.params.taskTypeId,
      addButtonText: "Create New Task",
    });

  taskOverview = () => {
    const collection = new TaskOverviewCollection();
    const view = new TaskOverviewView({ collection });

    return <BackboneWrapper backboneView={view} />;
  };

  workload = () => this.showWithPagination(WorkloadListView, WorkloadCollection);

  taskQuery = () => {
    const view = new TaskQueryView();

    return <BackboneWrapper backboneView={view} />;
  };

  taskEdit = ({ match }: ReactRouterArgumentsType) => {
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

  scriptsCreate = ({ match }: ReactRouterArgumentsType) => {
    const id = match.params.id || null;
    const model = new ScriptModel({ id });
    const view = new ScriptCreateView({ model });
    return <BackboneWrapper backboneView={view} />;
  };

  tracingView = ({ match }: ReactRouterArgumentsType) => (
    <TracingLayoutView
      initialTracingType={match.params.type}
      initialTracingId={match.params.id}
      initialControlmode={ControlModeEnum.TRACE}
    />
  );

  tracingViewPublic = ({ match }: ReactRouterArgumentsType) => (
    <TracingLayoutView
      initialTracingType={SkeletonTracingTypeTracingEnum.View}
      initialTracingId={match.params.id}
      initialControlmode={ControlModeEnum.VIEW}
    />
  );

  render() {
    const isAuthenticated = this.props.activeUser !== null;

    return (
      <Router history={app.history}>
        <LocaleProvider locale={enUS}>
          <Layout>
            <Navbar isAuthenticated={isAuthenticated} />
            <Content>
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                exact
                path="/"
                component={DashboardView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/dashboard"
                component={DashboardView}
              />

              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/users"
                component={UserListView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/teams"
                component={TeamListView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/statistics"
                component={StatisticView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/tasks"
                render={this.taskQuery}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/tasks/create"
                render={this.taskCreate}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/tasks/overview"
                render={this.taskOverview}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/tasks/:taskId/edit"
                render={this.taskEdit}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects"
                component={ProjectListView}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/create"
                render={this.projectCreate}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/:projectName/tasks"
                render={this.projectTasks}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/:id/edit"
                render={this.projectEdit}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/annotations/:type/:id"
                render={this.tracingView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/annotations/:type/:id/readOnly)"
                render={this.tracingView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/dashboard"
                component={DashboardView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets"
                component={DashboardView}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/upload"
                render={this.datasetAdd}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:datasetName/edit"
                component={DatasetImportView}
                isEditingMode
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:name/import"
                component={DatasetImportView}
                isEditingMode
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/users/:id/details"
                component={DashboardView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/taskTypes"
                component={TaskTypeListView}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/taskTypes/create"
                render={this.taskTypesCreate}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/taskTypes/:id/edit"
                render={this.taskTypesCreate}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/taskTypes/:taskTypeId/tasks"
                render={this.taskTypesTasks}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/scripts/create"
                render={this.scriptsCreate}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/scripts/:id/edit"
                render={this.scriptsCreate}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/scripts"
                component={ScriptListView}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/workload"
                render={this.workload}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/help/faq"
                component={FAQView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/help/keyboardshortcuts"
                component={KeyboardShortcutView}
              />

              <Route path="/login" render={() => <LoginView layout="horizontal" />} />
              <Route path="/register" component={RegistrationView} />
              <Route path="/reset" component={StartResetPasswordView} />
              <Route path="/finishreset" component={FinishResetPasswordView} />
              <Route path="/api/changepassword" component={ChangePasswordView} />
              <Route path="/spotlight" component={SpotlightView} />
              <Route path="/datasets/:id/view" render={this.tracingViewPublic} />
            </Content>
          </Layout>
        </LocaleProvider>
      </Router>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(ReactRouter);
