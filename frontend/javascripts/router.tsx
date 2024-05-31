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
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import OrganizationEditView from "admin/organization/organization_edit_view";
import ProjectCreateView from "admin/project/project_create_view";
import ProjectListView from "admin/project/project_list_view";
import ScriptCreateView from "admin/scripts/script_create_view";
import ScriptListView from "admin/scripts/script_list_view";
import AvailableTasksReportView from "admin/statistic/available_tasks_report_view";
import ProjectProgressReportView from "admin/statistic/project_progress_report_view";
import TaskCreateFormView from "admin/task/task_create_form_view";
import TaskCreateView from "admin/task/task_create_view";
import TaskListView from "admin/task/task_list_view";
import TaskTypeCreateView from "admin/tasktype/task_type_create_view";
import TaskTypeListView from "admin/tasktype/task_type_list_view";
import TeamListView from "admin/team/team_list_view";
import UserListView from "admin/user/user_list_view";
import { Button, Col, Layout, Result, Row } from "antd";
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
import React from "react";
import { connect } from "react-redux";
// @ts-expect-error ts-migrate(2305) FIXME: Module '"react-router-dom"' has no exported member... Remove this comment to see the full error message
import { ContextRouter, Link, RouteProps } from "react-router-dom";
import { Redirect, Route, Router, Switch } from "react-router-dom";
import {
  APICompoundTypeEnum,
  APIResolutionRestrictions,
  APIUser,
  TracingTypeEnum,
} from "types/api_flow_types";

import ErrorBoundary from "components/error_boundary";
import { Store } from "oxalis/singletons";
import VerifyEmailView from "admin/auth/verify_email_view";
import TimeTrackingOverview from "admin/statistic/time_tracking_overview";
import loadable from "libs/lazy_loader";
import { EmptyObject } from "types/globals";
import AiModelListView from "admin/voxelytics/ai_model_list_view";

const { Content } = Layout;

const AsyncWorkflowView = loadable<EmptyObject>(() => import("admin/voxelytics/workflow_view"));
const AsyncWorkflowListView = loadable<EmptyObject>(
  () => import("admin/voxelytics/workflow_list_view"),
);

type StateProps = {
  activeUser: APIUser | null | undefined;
  hasOrganizations: boolean;
  pricingPlan: PricingPlanEnum;
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
    <Row justify="center" align="middle" className="background-organelles">
      <Col>
        <Result
          icon={<i className="drawing drawing-404" />}
          status="warning"
          title={
            <span style={{ color: "white" }}>Sorry, the page you visited does not exist.</span>
          }
          style={{ height: "100%" }}
          extra={[
            <Link to="/">
              <Button>Back to Dashboard</Button>
            </Link>,
          ]}
        />
      </Col>
    </Row>
  );
}

type GetComponentProps<T> = T extends React.ComponentType<infer P> | React.Component<infer P>
  ? P
  : never;

const RouteWithErrorBoundary: React.FC<RouteProps> = (props) => {
  return (
    <ErrorBoundary key={props.location?.pathname}>
      <Route {...props} />
    </ErrorBoundary>
  );
};

const SecuredRouteWithErrorBoundary: React.FC<GetComponentProps<typeof SecuredRoute>> = (props) => {
  return (
    // @ts-expect-error Accessing props.location works as intended.
    <ErrorBoundary key={props.location?.pathname}>
      <SecuredRoute {...props} />
    </ErrorBoundary>
  );
};

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
    } catch (_ex) {
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
          <CheckTermsOfServices />
          <Navbar isAuthenticated={isAuthenticated} />
          <HelpButton />
          <Content>
            <Switch>
              <RouteWithErrorBoundary
                exact
                path="/"
                render={() => {
                  if (!this.props.hasOrganizations && !features().isWkorgInstance) {
                    return <Redirect to="/onboarding" />;
                  }

                  if (isAuthenticated) {
                    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
                  }

                  return <Redirect to="/auth/login" />;
                }}
              />
              <SecuredRouteWithErrorBoundary
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

              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/dashboard/datasets/:folderIdWithName"
                render={() => {
                  const initialTabKey = "datasets";
                  return (
                    <DashboardView
                      userId={null}
                      isAdminView={false}
                      initialTabKey={initialTabKey}
                    />
                  );
                }}
              />

              <RouteWithErrorBoundary
                path="/dashboard"
                render={() => {
                  // Imperatively access store state to avoid race condition when logging in.
                  // The `isAuthenticated` prop could be outdated for a short time frame which
                  // would lead to an unnecessary browser refresh.
                  const { activeUser } = Store.getState();
                  if (activeUser) {
                    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
                  }

                  // Hard navigate so that webknossos.org is shown for the wkorg instance.
                  window.location.href = "/";
                  return null;
                }}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/users/:userId/details"
                requiresAdminOrManagerRole
                render={({ match }: ContextRouter) => (
                  <DashboardView
                    userId={match.params.userId}
                    isAdminView={match.params.userId !== null}
                    initialTabKey={null}
                  />
                )}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/users"
                component={UserListView}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/teams"
                component={TeamListView}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/timetracking"
                component={TimeTrackingOverview}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                requiredPricingPlan={PricingPlanEnum.Team}
                path="/reports/projectProgress"
                component={ProjectProgressReportView}
                requiresAdminOrManagerRole
                exact
              />
              <RouteWithErrorBoundary
                path="/reports/openTasks"
                render={() => <Redirect to="/reports/availableTasks" />}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                requiredPricingPlan={PricingPlanEnum.Team}
                path="/reports/availableTasks"
                component={AvailableTasksReportView}
                requiresAdminOrManagerRole
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/tasks"
                requiredPricingPlan={PricingPlanEnum.Team}
                component={TaskListView}
                requiresAdminOrManagerRole
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/tasks/create"
                requiredPricingPlan={PricingPlanEnum.Team}
                component={TaskCreateView}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/tasks/:taskId/edit"
                requiredPricingPlan={PricingPlanEnum.Team}
                requiresAdminOrManagerRole
                render={({ match }: ContextRouter) => (
                  <TaskCreateFormView taskId={match.params.taskId} />
                )}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/tasks/:taskId"
                requiredPricingPlan={PricingPlanEnum.Team}
                requiresAdminOrManagerRole
                render={({ match }: ContextRouter) => (
                  <TaskListView
                    initialFieldValues={{
                      taskId: match.params.taskId || "",
                    }}
                  />
                )}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/projects"
                requiredPricingPlan={PricingPlanEnum.Team}
                requiresAdminOrManagerRole
                render={(
                  { location }: ContextRouter, // Strip the leading # away. If there is no hash, "".slice(1) will evaluate to "", too.
                ) => <ProjectListView initialSearchValue={location.hash.slice(1)} />}
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/projects/create"
                requiredPricingPlan={PricingPlanEnum.Team}
                requiresAdminOrManagerRole
                render={() => <ProjectCreateView />}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/projects/:projectId/tasks"
                requiredPricingPlan={PricingPlanEnum.Team}
                requiresAdminOrManagerRole
                render={({ match }: ContextRouter) => (
                  <TaskListView
                    initialFieldValues={{
                      projectId: match.params.projectId || "",
                    }}
                  />
                )}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/projects/:projectId/edit"
                requiredPricingPlan={PricingPlanEnum.Team}
                requiresAdminOrManagerRole
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
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/datasets/upload"
                requiresAdminOrManagerRole
                render={() => <DatasetAddView />}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/datasets/:organizationName/:datasetName/edit"
                requiresAdminOrManagerRole
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
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/taskTypes"
                requiresAdminOrManagerRole
                render={(
                  { location }: ContextRouter, // Strip the leading # away. If there is no hash, "".slice(1) will evaluate to "", too.
                ) => <TaskTypeListView initialSearchValue={location.hash.slice(1)} />}
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/taskTypes/create"
                requiredPricingPlan={PricingPlanEnum.Team}
                component={TaskTypeCreateView}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/taskTypes/:taskTypeId/edit"
                requiredPricingPlan={PricingPlanEnum.Team}
                render={({ match }: ContextRouter) => (
                  <TaskTypeCreateView taskTypeId={match.params.taskTypeId} />
                )}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/taskTypes/:taskTypeId/tasks"
                requiredPricingPlan={PricingPlanEnum.Team}
                render={({ match }: ContextRouter) => (
                  <TaskListView
                    initialFieldValues={{
                      taskTypeId: match.params.taskTypeId || "",
                    }}
                  />
                )}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/taskTypes/:taskTypeId/projects"
                requiredPricingPlan={PricingPlanEnum.Team}
                render={({ match }: ContextRouter) => (
                  <ProjectListView taskTypeId={match.params.taskTypeId || ""} />
                )}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/scripts/create"
                render={() => <ScriptCreateView />}
                requiresAdminOrManagerRole
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/scripts/:scriptId/edit"
                requiresAdminOrManagerRole
                render={({ match }: ContextRouter) => (
                  <ScriptCreateView scriptId={match.params.scriptId} />
                )}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/scripts"
                component={ScriptListView}
                requiresAdminOrManagerRole
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/jobs"
                render={() => <JobListView />}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/organizations/:organizationName"
                render={() => <OrganizationEditView />}
              />
              <RouteWithErrorBoundary
                path="/help/keyboardshortcuts"
                render={() => (
                  <Redirect to="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html" />
                )}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/auth/token"
                component={AuthTokenView}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/auth/changePassword"
                component={ChangePasswordView}
              />
              <RouteWithErrorBoundary path="/login" render={() => <Redirect to="/auth/login" />} />

              <RouteWithErrorBoundary
                path="/invite/:token"
                render={({ match }: ContextRouter) => (
                  <AcceptInviteView
                    activeUser={this.props.activeUser}
                    token={match.params.token || ""}
                  />
                )}
              />

              <RouteWithErrorBoundary
                path="/verifyEmail/:token"
                render={({ match }: ContextRouter) => (
                  <VerifyEmailView token={match.params.token || ""} />
                )}
              />

              <RouteWithErrorBoundary
                path="/signup"
                render={() => <Redirect to="/auth/signup" />}
              />
              <RouteWithErrorBoundary
                path="/register"
                render={() => <Redirect to="/auth/signup" />}
              />
              <RouteWithErrorBoundary
                path="/auth/register"
                render={() => <Redirect to="/auth/signup" />}
              />
              <RouteWithErrorBoundary
                path="/auth/login"
                render={() => (isAuthenticated ? <Redirect to="/" /> : <LoginView />)}
              />
              <RouteWithErrorBoundary
                path="/auth/signup"
                render={() => (isAuthenticated ? <Redirect to="/" /> : <RegistrationView />)}
              />

              <RouteWithErrorBoundary
                path="/auth/resetPassword"
                component={StartResetPasswordView}
              />
              <RouteWithErrorBoundary
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
              <RouteWithErrorBoundary
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
              <RouteWithErrorBoundary
                path="/datasets/:organizationName/:datasetName/sandbox/:type"
                render={this.tracingSandbox}
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/datasets/:organizationName/:datasetName/createExplorative/:type"
                render={({ match }: ContextRouter) => (
                  <AsyncRedirect
                    pushToHistory={false}
                    redirectTo={async () => {
                      if (
                        !match.params.organizationName ||
                        !match.params.datasetName ||
                        !match.params.type
                      ) {
                        // Typehint for TS
                        throw new Error("Invalid URL");
                      }

                      const dataset = {
                        owningOrganization: match.params.organizationName,
                        name: match.params.datasetName,
                      };
                      const type =
                        coalesce(TracingTypeEnum, match.params.type) || TracingTypeEnum.skeleton;
                      const getParams = Utils.getUrlParamsObjectFromString(location.search);
                      const { autoFallbackLayer, fallbackLayerName } = getParams;
                      const resolutionRestrictions: APIResolutionRestrictions = {};

                      if (getParams.minRes !== undefined) {
                        resolutionRestrictions.min = parseInt(getParams.minRes);

                        if (!_.isNumber(resolutionRestrictions.min)) {
                          throw new Error("Invalid minRes parameter");
                        }
                      }

                      if (getParams.maxRes !== undefined) {
                        resolutionRestrictions.max = parseInt(getParams.maxRes);

                        if (!_.isNumber(resolutionRestrictions.max)) {
                          throw new Error("Invalid maxRes parameter");
                        }
                      }

                      const annotation = await createExplorational(
                        dataset,
                        type,
                        !!autoFallbackLayer,
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
              <RouteWithErrorBoundary
                path="/publications/:id"
                render={({ match }: ContextRouter) => (
                  <PublicationDetailView publicationId={match.params.id || ""} />
                )}
              />
              <Redirect from="/publication/:id" to="/publications/:id" />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/workflows"
                component={AsyncWorkflowListView}
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/aiModels"
                component={AiModelListView}
                exact
              />
              <SecuredRouteWithErrorBoundary
                isAuthenticated={isAuthenticated}
                path="/workflows/:workflowName"
                component={AsyncWorkflowView}
              />
              <RouteWithErrorBoundary path="/imprint" component={Imprint} />
              <RouteWithErrorBoundary path="/privacy" component={Privacy} />
              <RouteWithErrorBoundary
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
              {!features().isWkorgInstance && (
                <RouteWithErrorBoundary path="/onboarding" component={Onboarding} />
              )}
              <RouteWithErrorBoundary component={PageNotFoundView} />
            </Switch>
          </Content>
        </Layout>
      </Router>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
  pricingPlan: state.activeOrganization
    ? state.activeOrganization.pricingPlan
    : PricingPlanEnum.Basic,
  hasOrganizations: state.uiInformation.hasOrganizations,
});

const connector = connect(mapStateToProps);
export default connector(ReactRouter);
