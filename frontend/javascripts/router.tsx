import {
  createExplorational,
  getAnnotationInformation,
  getOrganizationForDataset,
  getShortLink,
} from "admin/admin_rest_api";
import AcceptInviteView from "admin/auth/accept_invite_view";
import AuthTokenView from "admin/auth/auth_token_view";
import ChangePasswordView from "admin/auth/change_password_view";
import FinishResetPasswordView from "admin/auth/finish_reset_password_view";
import LoginView from "admin/auth/login_view";
import RegistrationView from "admin/auth/registration_view";
import StartResetPasswordView from "admin/auth/start_reset_password_view";
import DatasetAddView from "admin/dataset/dataset_add_view";
import JobListView from "admin/job/job_list_view";
import Onboarding from "admin/onboarding";
import OrganizationEditView from "admin/organization/organization_edit_view";
import ProjectCreateView from "admin/project/project_create_view";
import ProjectListView from "admin/project/project_list_view";
import ScriptCreateView from "admin/scripts/script_create_view";
import ScriptListView from "admin/scripts/script_list_view";
import OpenTasksReportView from "admin/statistic/open_tasks_report_view";
import ProjectProgressReportView from "admin/statistic/project_progress_report_view";
import StatisticView from "admin/statistic/statistic_view";
import TaskCreateFormView from "admin/task/task_create_form_view";
import TaskCreateView from "admin/task/task_create_view";
import TaskListView from "admin/task/task_list_view";
import TaskTypeCreateView from "admin/tasktype/task_type_create_view";
import TaskTypeListView from "admin/tasktype/task_type_list_view";
import TeamListView from "admin/team/team_list_view";
import TimeLineView from "admin/time/time_line_view";
import UserListView from "admin/user/user_list_view";
import { Alert, Layout } from "antd";
import AdaptViewportMetatag from "components/adapt_viewport_metatag";
import DisableGenericDnd from "components/disable_generic_dnd";
import { Imprint, Privacy } from "components/legal";
import AsyncRedirect from "components/redirect";
import SecuredRoute from "components/secured_route";
import { CheckTermsOfServices } from "components/terms_of_services_check";
import DashboardView, { urlTokenToTabKeyMap } from "dashboard/dashboard_view";
import DatasetSettingsView from "dashboard/dataset/dataset_settings_view";
import PublicationDetailView from "dashboard/publication_details_view";
import features from "features";
import { createBrowserHistory } from "history";
import * as Utils from "libs/utils";
import { coalesce } from "libs/utils";
import window from "libs/window";
import _ from "lodash";
import Navbar from "navbar";
import { ControlModeEnum } from "oxalis/constants";
import { trackAction } from "oxalis/model/helpers/analytics";
import type { OxalisState } from "oxalis/store";
import HelpButton from "oxalis/view/help_modal";
import TracingLayoutView from "oxalis/view/layouting/tracing_layout_view";
import React, { lazy, Suspense } from "react";
import { connect } from "react-redux";
// @ts-expect-error ts-migrate(2305) FIXME: Module '"react-router-dom"' has no exported member... Remove this comment to see the full error message
import type { ContextRouter } from "react-router-dom";
import { Redirect, Route, Router, Switch } from "react-router-dom";
import { APICompoundTypeEnum, APIUser, TracingTypeEnum } from "types/api_flow_types";
const { Content } = Layout;

function loadable(loader: () => Promise<{ default: React.ComponentType<{}> }>) {
  const InternalComponent = lazy(loader);
  return function AsyncComponent() {
    return (
      <Suspense fallback={<div style={{ textAlign: "center" }}>Loading...</div>}>
        <InternalComponent />
      </Suspense>
    );
  };
}

const AsyncWorkflowView = loadable(() => import("admin/voxelytics/workflow_view"));
const AsyncWorkflowListView = loadable(() => import("admin/voxelytics/workflow_list_view"));

type StateProps = {
  activeUser: APIUser | null | undefined;
  hasOrganizations: boolean;
};
type Props = StateProps;
const browserHistory = createBrowserHistory();
browserHistory.listen((location) => {
  // @ts-ignore
  if (typeof window.ga !== "undefined" && window.ga !== null && window.ga.getByName != null) {
    // t0 is the default tracker name
    // @ts-ignore
    const tracker = window.ga.getByName("t0");
    if (tracker == null) return;
    const lastPage = tracker.get("page");
    const newPage = location.pathname;

    // The listener is called repeatedly for a single page change, don't send repeated pageviews
    if (lastPage !== newPage) {
      // Update the tracker state first, so that subsequent pageviews AND events use the correct page
      // @ts-ignore
      window.gtag("set", "page_path", newPage);
      // @ts-ignore
      window.gtag("event", "page_view");
    }
  }
});

function PageNotFoundView() {
  return (
    <div className="container">
      <Alert
        style={{
          maxWidth: "500px",
          margin: "0 auto",
        }}
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
    const initialMaybeCompoundType =
      match.params.type != null ? coalesce(APICompoundTypeEnum, match.params.type) : null;

    return (
      <TracingLayoutView
        initialMaybeCompoundType={initialMaybeCompoundType}
        initialCommandType={{
          type: ControlModeEnum.TRACE,
          annotationId: match.params.id || "",
        }}
      />
    );
  };

  tracingSandbox = ({ match }: ContextRouter) => {
    const tracingType = coalesce(TracingTypeEnum, match.params.type);

    if (tracingType != null) {
      return (
        <TracingLayoutView
          initialMaybeCompoundType={null}
          initialCommandType={{
            type: ControlModeEnum.SANDBOX,
            tracingType,
            name: match.params.datasetName || "",
            owningOrganization: match.params.organizationName || "",
          }}
        />
      );
    }

    return <h3>Invalid annotation URL.</h3>;
  };

  tracingViewMode = ({ match }: ContextRouter) => (
    <TracingLayoutView
      initialMaybeCompoundType={null}
      initialCommandType={{
        type: ControlModeEnum.VIEW,
        name: match.params.datasetName || "",
        owningOrganization: match.params.organizationName || "",
      }}
    />
  );

  serverAuthenticationCallback = async ({ match }: ContextRouter) => {
    try {
      const annotationInformation = await getAnnotationInformation(match.params.id || "");
      return annotationInformation.visibility === "Public";
    } catch (ex) {
      // Annotation could not be found
    }

    return false;
  };

  render() {
    const isAuthenticated = this.props.activeUser !== null;
    return (
      <Router history={browserHistory}>
        <Layout>
          <DisableGenericDnd />
          <AdaptViewportMetatag isAuthenticated={isAuthenticated} />
          <CheckTermsOfServices />
          <Navbar isAuthenticated={isAuthenticated} />
          <HelpButton />
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

                  return <Redirect to="/auth/login" />;
                }}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/dashboard/:tab"
                render={({ match }: ContextRouter) => {
                  const tab: string = match.params.tab;
                  const initialTabKey =
                    // @ts-ignore If tab does not exist in urlTokenToTabKeyMap, initialTabKey is still valid (i.e., undefined)
                    tab ? urlTokenToTabKeyMap[tab] : null;
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
                // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
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
                  <TaskListView
                    initialFieldValues={{
                      taskId: match.params.taskId || "",
                    }}
                  />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects"
                render={(
                  { location }: ContextRouter, // Strip the leading # away. If there is no hash, "".slice(1) will evaluate to "", too.
                ) => <ProjectListView initialSearchValue={location.hash.slice(1)} />}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/create"
                render={() => <ProjectCreateView />}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/:projectId/tasks"
                render={({ match }: ContextRouter) => (
                  <TaskListView
                    initialFieldValues={{
                      projectId: match.params.projectId || "",
                    }}
                  />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/projects/:projectId/edit"
                render={({ match }: ContextRouter) => (
                  <ProjectCreateView projectId={match.params.projectId} />
                )}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/annotations/:type/:id"
                render={({ location, match }: ContextRouter) => {
                  const initialMaybeCompoundType =
                    match.params.type != null
                      ? coalesce(APICompoundTypeEnum, match.params.type)
                      : null;

                  if (initialMaybeCompoundType == null) {
                    const { hash, search } = location;
                    return <Redirect to={`/annotations/${match.params.id}${search}${hash}`} />;
                  }

                  return this.tracingView({ match });
                }}
                serverAuthenticationCallback={this.serverAuthenticationCallback}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/annotations/:id"
                render={this.tracingView}
                serverAuthenticationCallback={this.serverAuthenticationCallback}
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
                  <DatasetSettingsView
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
                  <DatasetSettingsView
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
                render={(
                  { location }: ContextRouter, // Strip the leading # away. If there is no hash, "".slice(1) will evaluate to "", too.
                ) => <TaskTypeListView initialSearchValue={location.hash.slice(1)} />}
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
                    initialFieldValues={{
                      taskTypeId: match.params.taskTypeId || "",
                    }}
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
                  // @ts-expect-error ts-migrate(2339) FIXME: Property 'organizationName' does not exist on type... Remove this comment to see the full error message
                  <OrganizationEditView organizationName={match.params.organizationName || ""} />
                )}
              />
              <Route
                path="/help/keyboardshortcuts"
                render={() => (
                  <Redirect to="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html" />
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
                render={() => (isAuthenticated ? <Redirect to="/" /> : <LoginView />)}
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
                      return `/datasets/${organizationName}/${datasetName}/view${location.search}${location.hash}`;
                    }}
                  />
                )}
              />
              <Route
                path="/datasets/:organizationName/:datasetName/sandbox/:type"
                render={this.tracingSandbox}
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/datasets/:organizationName/:dataSetName/createExplorative/:type"
                render={({ match }: ContextRouter) => (
                  <AsyncRedirect
                    pushToHistory={false}
                    redirectTo={async () => {
                      if (
                        !match.params.organizationName ||
                        !match.params.dataSetName ||
                        !match.params.type
                      ) {
                        // Typehint for flow
                        throw new Error("Invalid URL");
                      }

                      const dataset = {
                        owningOrganization: match.params.organizationName,
                        name: match.params.dataSetName,
                      };
                      const type =
                        coalesce(TracingTypeEnum, match.params.type) || TracingTypeEnum.skeleton;
                      const getParams = Utils.getUrlParamsObjectFromString(location.search);
                      const { fallbackLayerName } = getParams;
                      const resolutionRestrictions = {};

                      if (getParams.minRes !== undefined) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'min' does not exist on type '{}'.
                        resolutionRestrictions.min = parseInt(getParams.minRes);

                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'min' does not exist on type '{}'.
                        if (!_.isNumber(resolutionRestrictions.min)) {
                          throw new Error("Invalid minRes parameter");
                        }
                      }

                      if (getParams.maxRes !== undefined) {
                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'max' does not exist on type '{}'.
                        resolutionRestrictions.max = parseInt(getParams.maxRes);

                        // @ts-expect-error ts-migrate(2339) FIXME: Property 'max' does not exist on type '{}'.
                        if (!_.isNumber(resolutionRestrictions.max)) {
                          throw new Error("Invalid maxRes parameter");
                        }
                      }

                      const annotation = await createExplorational(
                        dataset,
                        type,
                        fallbackLayerName,
                        null,
                        resolutionRestrictions,
                      );
                      trackAction(`Create ${type} tracing`);
                      return `/annotations/${annotation.id}`;
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
                path="/publications/:id"
                render={({ match }: ContextRouter) => (
                  <PublicationDetailView publicationId={match.params.id || ""} />
                )}
              />
              <Redirect from="/publication/:id" to="/publications/:id" />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/workflows"
                component={AsyncWorkflowListView}
                exact
              />
              <SecuredRoute
                isAuthenticated={isAuthenticated}
                path="/workflows/:workflowName"
                component={AsyncWorkflowView}
              />
              <Route path="/imprint" component={Imprint} />
              <Route path="/privacy" component={Privacy} />
              <Route
                path="/links/:key"
                render={({ match }: ContextRouter) => (
                  <AsyncRedirect
                    redirectTo={async () => {
                      const key = match.params.key || "";
                      const shortLink = await getShortLink(key);
                      return shortLink.longLink;
                    }}
                  />
                )}
              />
              {!features().isDemoInstance && <Route path="/onboarding" component={Onboarding} />}
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

const connector = connect(mapStateToProps);
export default connector(ReactRouter);
