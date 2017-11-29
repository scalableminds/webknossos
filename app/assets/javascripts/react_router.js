// @flow
/* eslint-disable react/no-unused-prop-types */
import React from "react";
import { Router, Route, Switch } from "react-router-dom";
import createBrowserHistory from "history/createBrowserHistory";
import { connect } from "react-redux";
import { Layout, LocaleProvider } from "antd";
import enUS from "antd/lib/locale-provider/en_US";

import { ControlModeEnum } from "oxalis/constants";
import { APITracingTypeEnum } from "admin/api_flow_types";
import { getAnnotationInformation } from "admin/admin_rest_api";
import SecuredRoute from "components/secured_route";
import Navbar from "navbar";

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
import KeyboardShortcutView from "admin/views/help/keyboardshortcut_view";
import DatasetAddView from "admin/views/dataset/dataset_add_view";
import UserListView from "admin/views/user/user_list_view";
import TeamListView from "admin/views/team/team_list_view";
import TaskListView from "admin/views/task/task_list_view";
import TaskTypeListView from "admin/views/tasktype/task_type_list_view";
import ProjectListView from "admin/views/project/project_list_view";
import StatisticView from "admin/views/statistic/statistic_view";
import ScriptListView from "admin/views/scripts/script_list_view";
import ProjectCreateView from "admin/views/project/project_create_view";
import TaskCreateView from "admin/views/task/task_create_view";
import TaskCreateFormView from "admin/views/task/task_create_form_view";
import TaskTypeCreateView from "admin/views/tasktype/task_type_create_view";
import ScriptCreateView from "admin/views/scripts/script_create_view";
import TimeLineView from "admin/views/time/time_line_view";

import type { OxalisState } from "oxalis/store";
import type { APITracingType, APIUserType } from "admin/api_flow_types";

const { Content } = Layout;

export type ReactRouterLocationType = {
  key: string,
  pathname: string,
  search: string,
  hash: string,
  state: Object,
};

export type ReactRouterHistoryType = {
  length: number,
  action: string,
  location: ReactRouterLocationType,
  pathname: string,
  search: string,
  hash: string,
  state: string,
  push: (string, ?Object) => void,
  replace: (string, ?Object) => void,
  go: number => void,
  goBack: () => void,
  goForward: () => void,
  block: Function => ?string | null,
};

export type ReactRouterMatchType = {
  params: { [string]: string },
  isExact: boolean,
  path: string,
  url: string,
};

type ReactRouterArgumentsType = {
  location: ReactRouterLocationType,
  match: ReactRouterMatchType,
  history: ReactRouterHistoryType,
};

type StateProps = {
  activeUser: ?APIUserType,
};

type Props = StateProps;

const browserHistory = createBrowserHistory();
browserHistory.listen(location => {
  if (typeof window.ga !== "undefined" && window.ga !== null) {
    window.ga("send", "pageview", location.pathname);
  }
});

class ReactRouter extends React.Component<Props> {
  tracingView = ({ match }: ReactRouterArgumentsType) => {
    const tracingType = match.params.type;
    const isValidTracingType = Object.keys(APITracingTypeEnum).includes(tracingType);

    if (isValidTracingType) {
      const saveTracingType = ((tracingType: any): APITracingType);
      return (
        <TracingLayoutView
          initialTracingType={saveTracingType}
          initialAnnotationId={match.params.id}
          initialControlmode={ControlModeEnum.TRACE}
        />
      );
    }

    return <h3>Invalid tracing URL.</h3>;
  };

  tracingViewMode = ({ match }: ReactRouterArgumentsType) => (
    <TracingLayoutView
      initialTracingType={APITracingTypeEnum.View}
      initialAnnotationId={match.params.id}
      initialControlmode={ControlModeEnum.VIEW}
    />
  );

  componentDidCatch(error, info) {
    // Log error and do something about it
    console.log("Error in router:", error, info);
  }

  render() {
    const isAuthenticated = this.props.activeUser !== null;

    return (
      <Router history={browserHistory}>
        <LocaleProvider locale={enUS}>
          <Layout>
            <Navbar isAuthenticated={isAuthenticated} />
            <Content style={{ marginTop: 48 }}>
              <Switch>
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  exact
                  path="/"
                  render={() => <DashboardView userId={null} isAdminView={false} />}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/dashboard"
                  render={() => <DashboardView userId={null} isAdminView={false} />}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/users/:userId/details"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <DashboardView
                      userId={match.params.userId}
                      isAdminView={match.params.userId !== null}
                    />
                  )}
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
                  component={TaskListView}
                  exact
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/tasks/create"
                  component={TaskCreateView}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/tasks/:taskId/edit"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <TaskCreateFormView taskId={match.params.taskId} />
                  )}
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
                  component={ProjectCreateView}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/projects/:projectName/tasks"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <TaskListView initialFieldValues={{ projectName: match.params.projectName }} />
                  )}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/projects/:projectName/edit"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <ProjectCreateView projectName={match.params.projectName} />
                  )}
                />

                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/annotations/:type/:id"
                  render={this.tracingView}
                  serverAuthenticationCallback={async ({ match }: ReactRouterArgumentsType) => {
                    const isReadOnly = location.pathname.endsWith("readOnly");
                    if (isReadOnly) {
                      const annotationInformation = await getAnnotationInformation(
                        match.params.id,
                        match.params.type,
                      );
                      return annotationInformation.isPublic;
                    }
                    return false;
                  }}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/datasets/upload"
                  component={DatasetAddView}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/datasets/:datasetName/import"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <DatasetImportView
                      isEditingMode={false}
                      datasetName={match.params.datasetName}
                    />
                  )}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/datasets/:datasetName/edit"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <DatasetImportView isEditingMode datasetName={match.params.datasetName} />
                  )}
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
                  component={TaskTypeCreateView}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/taskTypes/:taskTypeId/edit"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <TaskTypeCreateView taskTypeId={match.params.taskTypeId} />
                  )}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/taskTypes/:taskTypeId/tasks"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <TaskListView initialFieldValues={{ taskTypeId: match.params.taskTypeId }} />
                  )}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/scripts/create"
                  component={ScriptCreateView}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/scripts/:scriptId/edit"
                  render={({ match }: ReactRouterArgumentsType) => (
                    <ScriptCreateView scriptId={match.params.scriptId} />
                  )}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/scripts"
                  component={ScriptListView}
                  exact
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/help/keyboardshortcuts"
                  component={KeyboardShortcutView}
                />
                <SecuredRoute
                  isAuthenticated={isAuthenticated}
                  path="/timetracking"
                  component={TimeLineView}
                />
                <Route path="/login" render={() => <LoginView layout="horizontal" />} />
                <Route path="/register" component={RegistrationView} />
                <Route path="/reset" component={StartResetPasswordView} />
                <Route path="/finishreset" component={FinishResetPasswordView} />
                <Route path="/changepassword" component={ChangePasswordView} />
                <Route path="/spotlight" component={SpotlightView} />
                <Route path="/datasets/:id/view" render={this.tracingViewMode} />
              </Switch>
            </Content>
          </Layout>
        </LocaleProvider>
      </Router>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(ReactRouter);
