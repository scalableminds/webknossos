// @flow
import { type ContextRouter, Redirect, Route, Router, Switch } from "react-router-dom";
import { Layout, Alert } from "antd";
import { connect } from "react-redux";
import Enum from "Enumjs";
import React from "react";
import { createBrowserHistory } from "history";

import AcceptInviteView from "admin/auth/accept_invite_view";
import { APIAnnotationTypeEnum, type APIUser, TracingTypeEnum } from "types/api_flow_types";
import { ControlModeEnum } from "oxalis/constants";
import { Imprint, Privacy } from "components/legal";
import type { OxalisState } from "oxalis/store";
import {
  getAnnotationInformation,
  getOrganizationForDataset,
  createExplorational,
} from "admin/admin_rest_api";
import AdaptViewportMetatag from "components/adapt_viewport_metatag";
import AsyncRedirect from "components/redirect";
import AuthTokenView from "admin/auth/auth_token_view";
import ChangePasswordView from "admin/auth/change_password_view";
import DashboardView, { urlTokenToTabKeyMap } from "dashboard/dashboard_view";
import DatasetAddView from "admin/dataset/dataset_add_view";
import DatasetImportView from "dashboard/dataset/dataset_import_view";
import DisableGenericDnd from "components/disable_generic_dnd";
import FeaturesView from "pages/frontpage/features_view";
import FinishResetPasswordView from "admin/auth/finish_reset_password_view";
import JobListView from "admin/job/job_list_view";
import LoginView from "admin/auth/login_view";
import Navbar from "navbar";
import Onboarding from "admin/onboarding";
import OpenTasksReportView from "admin/statistic/open_tasks_report_view";
import OrganizationEditView from "admin/organization/organization_edit_view";
import PricingView from "pages/frontpage/pricing_view";
import ProjectCreateView from "admin/project/project_create_view";
import ProjectListView from "admin/project/project_list_view";
import ProjectProgressReportView from "admin/statistic/project_progress_report_view";
import PublicationDetailView from "dashboard/publication_details_view";
import RegistrationView from "admin/auth/registration_view";
import ScriptCreateView from "admin/scripts/script_create_view";
import ScriptListView from "admin/scripts/script_list_view";
import SecuredRoute from "components/secured_route";
import SpotlightView from "dashboard/spotlight_view";
import StartResetPasswordView from "admin/auth/start_reset_password_view";
import StatisticView from "admin/statistic/statistic_view";
import TaskCreateFormView from "admin/task/task_create_form_view";
import TaskCreateView from "admin/task/task_create_view";
import TaskListView from "admin/task/task_list_view";
import TaskTypeCreateView from "admin/tasktype/task_type_create_view";
import TaskTypeListView from "admin/tasktype/task_type_list_view";
import TeamListView from "admin/team/team_list_view";
import TimeLineView from "admin/time/time_line_view";
import TracingLayoutView from "oxalis/view/layouting/tracing_layout_view";
import UserListView from "admin/user/user_list_view";
import * as Utils from "libs/utils";
import features from "features";
import window from "libs/window";
import { trackAction } from "oxalis/model/helpers/analytics";

const { Content } = Layout;

type StateProps = {|
  activeUser: ?APIUser,
  hasOrganizations: boolean,
|};

type Props = StateProps;

const browserHistory = createBrowserHistory();
browserHistory.listen(location => {
  if (typeof window.ga !== "undefined" && window.ga !== null && window.ga.getByName != null) {
    // t0 is the default tracker name
    const tracker = window.ga.getByName("t0");
    if (tracker == null) return;
    const lastPage = tracker.get("page");
    const newPage = location.pathname;
    // The listener is called repeatedly for a single page change, don't send repeated pageviews
    if (lastPage !== newPage) {
      // Update the tracker state first, so that subsequent pageviews AND events use the correct page
      window.ga("set", "page", newPage);
      window.ga("send", "pageview");
    }
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
    const annotationType = Enum.coalesce(APIAnnotationTypeEnum, match.params.type);

    if (annotationType != null) {
      return (
        <TracingLayoutView
          initialAnnotationType={annotationType}
          initialCommandType={{
            type: ControlModeEnum.TRACE,
            annotationId: match.params.id || "",
          }}
        />
      );
    }

    return <h3>Invalid annotation URL.</h3>;
  };

  tracingViewMode = ({ match }: ContextRouter) => (
    <TracingLayoutView
      initialAnnotationType={APIAnnotationTypeEnum.View}
      initialCommandType={{
        type: ControlModeEnum.VIEW,
        name: match.params.datasetName || "",
        owningOrganization: match.params.organizationName || "",
      }}
    />
  );

  render() {
    const isAuthenticated = this.props.activeUser !== null;

    return (
      <Router history={browserHistory}>
        <Layout>
          <DisableGenericDnd />
          <AdaptViewportMetatag isAuthenticated={isAuthenticated} />
          <Navbar isAuthenticated={isAuthenticated} />
          <Content>
            <Switch>
              <Route
                exact
                path="/"
                render={() => {
                  if (!this.props.hasOrganizations && !features().isDemoInstance) {
                    return <Redirect to="/onboarding" />;
                  }
                  if (isAuthenticated) {
                    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
                  }
                  if (features().isDemoInstance) {
                    return <SpotlightView />;
                  }
                  return <Redirect to="/auth/login" />;
                }}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/dashboard/:tab"
                render={({ match }: ContextRouter) => {
                  const { tab } = match.params;
                  const initialTabKey = tab ? urlTokenToTabKeyMap[tab] : null;
                  return (
                    <DashboardView
                      userId={null}
                      isAdminView={false}
                      initialTabKey={initialTabKey}
                    />
                  );
                }}
              />

              <Route
                isAuthenticated={isAuthenticated}
                path="/dashboard"
                render={() => {
                  if (isAuthenticated) {
                    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
                  }
                  // Hard navigate
                  window.location.href = "/";
                  return null;
                }}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/users/:userId/details"
                render={({ match }: ContextRouter) => (
                  <DashboardView
                    userId={match.params.userId}
                    isAdminView={match.params.userId !== null}
                    initialTabKey={null}
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
                render={() => <ProjectCreateView />}
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
                  try {
                    const annotationInformation = await getAnnotationInformation(
                      match.params.id || "",
                      Enum.coalesce(APIAnnotationTypeEnum, match.params.type) ||
                        APIAnnotationTypeEnum.Explorational,
                    );
                    return annotationInformation.visibility === "Public";
                  } catch (ex) {
                    // Annotation could not be found
                  }
                  return false;
                }}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/upload"
                render={() => <DatasetAddView />}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:organizationName/:datasetName/import"
                render={({ match }: ContextRouter) => (
                  <DatasetImportView
                    isEditingMode={false}
                    datasetId={{
                      name: match.params.datasetName || "",
                      owningOrganization: match.params.organizationName || "",
                    }}
                    onComplete={() =>
                      window.location.replace(`${window.location.origin}/dashboard/datasets`)
                    }
                    onCancel={() => window.history.back()}
                  />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:organizationName/:datasetName/edit"
                render={({ match }: ContextRouter) => (
                  <DatasetImportView
                    isEditingMode
                    datasetId={{
                      name: match.params.datasetName || "",
                      owningOrganization: match.params.organizationName || "",
                    }}
                    onComplete={() => window.history.back()}
                    onCancel={() => window.history.back()}
                  />
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
                path="/taskTypes/:taskTypeId/projects"
                render={({ match }: ContextRouter) => (
                  <ProjectListView taskTypeId={match.params.taskTypeId || ""} />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/scripts/create"
                render={() => <ScriptCreateView />}
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
                path="/jobs"
                render={() => <JobListView />}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/organizations/:organizationName/edit"
                render={({ match }) => (
                  <OrganizationEditView organizationName={match.params.organizationName || ""} />
                )}
              />
              <Route
                path="/help/keyboardshortcuts"
                render={() => (
                  <Redirect to="https://docs.webknossos.org/reference/keyboard_shortcuts" />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/reports/timetracking"
                render={() => <TimeLineView />}
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

              <Route
                path="/invite/:token"
                render={({ match }: ContextRouter) => (
                  <AcceptInviteView
                    activeUser={this.props.activeUser}
                    token={match.params.token || ""}
                  />
                )}
              />

              <Route path="/signup" render={() => <Redirect to="/auth/signup" />} />
              <Route path="/register" render={() => <Redirect to="/auth/signup" />} />
              <Route path="/auth/register" render={() => <Redirect to="/auth/signup" />} />
              <Route
                path="/auth/login"
                render={() =>
                  isAuthenticated ? <Redirect to="/" /> : <LoginView layout="horizontal" />
                }
              />
              <Route
                path="/auth/signup"
                render={() => (isAuthenticated ? <Redirect to="/" /> : <RegistrationView />)}
              />

              <Route path="/auth/resetPassword" component={StartResetPasswordView} />
              <Route
                path="/auth/finishResetPassword"
                render={({ location }: ContextRouter) => {
                  const params = Utils.getUrlParamsObjectFromString(location.search);
                  return <FinishResetPasswordView resetToken={params.token} />;
                }}
              />
              <Route path="/spotlight" component={SpotlightView} />
              <Route
                path="/datasets/:organizationName/:datasetName/view"
                render={this.tracingViewMode}
              />
              <Route
                path="/datasets/:id/view"
                render={({ match, location }: ContextRouter) => (
                  <AsyncRedirect
                    redirectTo={async () => {
                      const datasetName = match.params.id || "";
                      const organizationName = await getOrganizationForDataset(datasetName);
                      return `/datasets/${organizationName}/${datasetName}/view${location.search}${
                        location.hash
                      }`;
                    }}
                  />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:organizationName/:dataSetName/createExplorative/:type/:withFallback"
                render={({ match }: ContextRouter) => (
                  <AsyncRedirect
                    pushToHistory={false}
                    redirectTo={async () => {
                      if (
                        !match.params.organizationName ||
                        !match.params.dataSetName ||
                        !match.params.type ||
                        !match.params.withFallback
                      ) {
                        // Typehint for flow
                        throw new Error("Invalid URL");
                      }

                      const dataset = {
                        owningOrganization: match.params.organizationName,
                        name: match.params.dataSetName,
                      };
                      const type =
                        Enum.coalesce(TracingTypeEnum, match.params.type) ||
                        TracingTypeEnum.skeleton;
                      const withFallback = match.params.withFallback === "true";
                      const annotation = await createExplorational(dataset, type, withFallback);
                      trackAction(`Create ${type} tracing`);
                      return `/annotations/${annotation.typ}/${annotation.id}`;
                    }}
                  />
                )}
              />
              {
                // Note that this route has to be beneath all others sharing the same prefix,
                // to avoid url mismatching
              }
              <Route
                path="/datasets/:organizationName/:datasetName"
                render={this.tracingViewMode}
              />
              <Route
                path="/publication/:id"
                render={({ match }: ContextRouter) => (
                  <PublicationDetailView publicationId={match.params.id || ""} />
                )}
              />
              <Route path="/imprint" component={Imprint} />
              <Route path="/privacy" component={Privacy} />
              {!features().isDemoInstance && <Route path="/onboarding" component={Onboarding} />}
              <Route path="/features" component={FeaturesView} />
              <Route path="/pricing" component={PricingView} />
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
  hasOrganizations: state.uiInformation.hasOrganizations,
});

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(ReactRouter);
