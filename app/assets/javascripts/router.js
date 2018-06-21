// @flow
/* eslint-disable react/no-unused-prop-types */
import React from "react";
import { Router, Route, Switch, Redirect } from "react-router-dom";
import createBrowserHistory from "history/createBrowserHistory";
import { connect } from "react-redux";
import { Layout, Alert } from "antd";
import Enum from "Enumjs";

import window from "libs/window";
import { ControlModeEnum } from "oxalis/constants";
import { APITracingTypeEnum } from "admin/api_flow_types";
import { getAnnotationInformation } from "admin/admin_rest_api";
import SecuredRoute from "components/secured_route";
import Navbar from "navbar";
import { Imprint, Privacy } from "components/legal";

import TracingLayoutView from "oxalis/view/tracing_layout_view";
import DashboardView from "dashboard/dashboard_view";
import SpotlightView from "dashboard/spotlight_view";
import LoginView from "admin/auth/login_view";
import RegistrationView from "admin/auth/registration_view";
import StartResetPasswordView from "admin/auth/start_reset_password_view";
import FinishResetPasswordView from "admin/auth/finish_reset_password_view";
import ChangePasswordView from "admin/auth/change_password_view";
import AuthTokenView from "admin/auth/auth_token_view";
import DatasetImportView from "dashboard/dataset/dataset_import_view";

// admin
import KeyboardShortcutView from "admin/help/keyboardshortcut_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import UserListView from "admin/user/user_list_view";
import TeamListView from "admin/team/team_list_view";
import TaskListView from "admin/task/task_list_view";
import TaskTypeListView from "admin/tasktype/task_type_list_view";
import ProjectListView from "admin/project/project_list_view";
import StatisticView from "admin/statistic/statistic_view";
import ProjectProgressReportView from "admin/statistic/project_progress_report_view";
import OpenTasksReportView from "admin/statistic/open_tasks_report_view";
import ScriptListView from "admin/scripts/script_list_view";
import ProjectCreateView from "admin/project/project_create_view";
import TaskCreateView from "admin/task/task_create_view";
import TaskCreateFormView from "admin/task/task_create_form_view";
import TaskTypeCreateView from "admin/tasktype/task_type_create_view";
import ScriptCreateView from "admin/scripts/script_create_view";
import TimeLineView from "admin/time/time_line_view";

import type { OxalisState } from "oxalis/store";
import type { APIUserType } from "admin/api_flow_types";
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
    const tracingType = Enum.coalesce(APITracingTypeEnum, match.params.type);

    if (tracingType != null) {
      return (
        <TracingLayoutView
          initialTracingType={tracingType}
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
              <Route
                exact
                path="/"
                render={() =>
                  isAuthenticated ? (
                    <DashboardView userId={null} isAdminView={false} />
                  ) : (
                    <SpotlightView />
                  )
                }
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
                render={({ location }: ContextRouter) => (
                  // Strip the leading # away. If there is no hash, "".slice(1) will evaluate to "", too.
                  <ProjectListView initialSearchValue={location.hash.slice(1)} />
                )}
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
                      Enum.coalesce(APITracingTypeEnum, match.params.type) ||
                        APITracingTypeEnum.Explorational,
                    );
                    return annotationInformation.isPublic;
                  }
                  return false;
                }}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/upload"
                component={DatasetUploadView}
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
                render={({ location }: ContextRouter) => (
                  // Strip the leading # away. If there is no hash, "".slice(1) will evaluate to "", too.
                  <TaskTypeListView initialSearchValue={location.hash.slice(1)} />
                )}
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
              <Route path="/imprint" component={Imprint} />
              <Route path="/privacy" component={Privacy} />
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
