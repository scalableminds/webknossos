// @flow
/* eslint-disable react/no-unused-prop-types */
import React from "react";
import { Router, Route, Switch, Redirect } from "react-router-dom";
import createBrowserHistory from "history/createBrowserHistory";
import { connect } from "react-redux";
import { Layout, Alert } from "antd";

import window from "libs/window";
import { ControlModeEnum } from "oxalis/constants";
import { APITracingTypeEnum } from "admin/api_flow_types";
import { getAnnotationInformation } from "admin/admin_rest_api";
import SecuredRoute from "components/secured_route";
import Navbar from "navbar";
import Imprint from "components/imprint";

import TracingLayoutView from "oxalis/view/tracing_layout_view";
import DashboardView from "dashboard/views/dashboard_view";
import SpotlightView from "dashboard/views/spotlight_view";
import LoginView from "admin/views/auth/login_view";
import RegistrationView from "admin/views/auth/registration_view";
import StartResetPasswordView from "admin/views/auth/start_reset_password_view";
import FinishResetPasswordView from "admin/views/auth/finish_reset_password_view";
import ChangePasswordView from "admin/views/auth/change_password_view";
import AuthTokenView from "admin/views/auth/auth_token_view";
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
import ProjectProgressReportView from "admin/views/statistic/project_progress_report_view";
import OpenTasksReportView from "admin/views/statistic/open_tasks_report_view";
import ScriptListView from "admin/views/scripts/script_list_view";
import ProjectCreateView from "admin/views/project/project_create_view";
import TaskCreateView from "admin/views/task/task_create_view";
import TaskCreateFormView from "admin/views/task/task_create_form_view";
import TaskTypeCreateView from "admin/views/tasktype/task_type_create_view";
import ScriptCreateView from "admin/views/scripts/script_create_view";
import TimeLineView from "admin/views/time/time_line_view";

import type { OxalisState } from "oxalis/store";
import type { APITracingType, APIUserType } from "admin/api_flow_types";
import type { ContextRouter } from "react-router-dom";

const { Content } = Layout;

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

function PageNotFoundView() {
  return (
    <div className="container">
      <Alert
        style={{ maxWidth: "500px", margin: "0 auto" }}
        message="Error 404"
        description="Page not found."
        type="error"
        showIcon
      />
    </div>
  );
}

class ReactRouter extends React.Component<Props> {
  tracingView = ({ match }: ContextRouter) => {
    const tracingType = match.params.type;
    const isValidTracingType = Object.keys(APITracingTypeEnum).includes(tracingType);

    if (isValidTracingType) {
      const saveTracingType = ((tracingType: any): APITracingType);
      return (
        <TracingLayoutView
          initialTracingType={saveTracingType}
          initialAnnotationId={match.params.id || ""}
          initialControlmode={ControlModeEnum.TRACE}
        />
      );
    }

    return <h3>Invalid tracing URL.</h3>;
  };

  tracingViewMode = ({ match }: ContextRouter) => (
    <TracingLayoutView
      initialTracingType={APITracingTypeEnum.View}
      initialAnnotationId={match.params.id || ""}
      initialControlmode={ControlModeEnum.VIEW}
    />
  );

  render() {
    const isAuthenticated = this.props.activeUser !== null;

    return (
      <Router history={browserHistory}>
        <Layout>
          <Navbar isAuthenticated={isAuthenticated} />
          <Content>
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
                render={({ match }: ContextRouter) => (
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
                path="/reports/projectProgress"
                component={ProjectProgressReportView}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/reports/openTasks"
                component={OpenTasksReportView}
                exact
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
                render={({ match }: ContextRouter) => (
                  <TaskCreateFormView taskId={match.params.taskId} />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/tasks/:taskId"
                render={({ match }: ContextRouter) => (
                  <TaskListView initialFieldValues={{ taskId: match.params.taskId || "" }} />
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
                render={({ match }: ContextRouter) => (
                  <TaskListView
                    initialFieldValues={{ projectName: match.params.projectName || "" }}
                  />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/:projectName/edit"
                render={({ match }: ContextRouter) => (
                  <ProjectCreateView projectName={match.params.projectName} />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/annotations/:type/:id"
                render={this.tracingView}
                serverAuthenticationCallback={async ({ match }: ContextRouter) => {
                  const isReadOnly = window.location.pathname.endsWith("readOnly");
                  if (isReadOnly) {
                    const annotationInformation = await getAnnotationInformation(
                      match.params.id || "",
                      match.params.type || "",
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
                render={({ match }: ContextRouter) => (
                  <DatasetImportView
                    isEditingMode={false}
                    datasetName={match.params.datasetName || ""}
                  />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:datasetName/edit"
                render={({ match }: ContextRouter) => (
                  <DatasetImportView isEditingMode datasetName={match.params.datasetName || ""} />
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
                render={({ match }: ContextRouter) => (
                  <TaskTypeCreateView taskTypeId={match.params.taskTypeId} />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/taskTypes/:taskTypeId/tasks"
                render={({ match }: ContextRouter) => (
                  <TaskListView
                    initialFieldValues={{ taskTypeId: match.params.taskTypeId || "" }}
                  />
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
                render={({ match }: ContextRouter) => (
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
                path="/reports/timetracking"
                component={TimeLineView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/auth/token"
                component={AuthTokenView}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/auth/changePassword"
                component={ChangePasswordView}
              />
              <Route path="/login" render={() => <Redirect to="/auth/login" />} />
              <Route path="/register" render={() => <Redirect to="/auth/register" />} />
              <Route path="/auth/login" render={() => <LoginView layout="horizontal" />} />
              <Route path="/auth/register" component={RegistrationView} />
              <Route path="/auth/resetPassword" component={StartResetPasswordView} />
              <Route path="/auth/finishResetPassword" component={FinishResetPasswordView} />
              <Route path="/spotlight" component={SpotlightView} />
              <Route path="/datasets/:id/view" render={this.tracingViewMode} />
              <Route path="/impressum" component={Imprint} />
              <Route component={PageNotFoundView} />
            </Switch>
          </Content>
        </Layout>
      </Router>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(ReactRouter);
