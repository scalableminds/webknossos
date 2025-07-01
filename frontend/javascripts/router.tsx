import AcceptInviteView from "admin/auth/accept_invite_view";
import FinishResetPasswordView from "admin/auth/finish_reset_password_view";
import LoginView from "admin/auth/login_view";
import RegistrationView from "admin/auth/registration_view";
import StartResetPasswordView from "admin/auth/start_reset_password_view";
import DatasetAddView from "admin/dataset/dataset_add_view";
import JobListView from "admin/job/job_list_view";
import Onboarding from "admin/onboarding";
import OrganizationView from "admin/organization/organization_view";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import ProjectCreateView from "admin/project/project_create_view";
import ProjectListView from "admin/project/project_list_view";
import {
  createExplorational,
  getShortLink,
  getUnversionedAnnotationInformation,
} from "admin/rest_api";
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
import SecuredRoute, { type SecuredRouteProps } from "components/secured_route";
import DashboardView, { urlTokenToTabKeyMap } from "dashboard/dashboard_view";
import DatasetSettingsView from "dashboard/dataset/dataset_settings_view";
import PublicationDetailView from "dashboard/publication_details_view";
import features from "features";
import * as Utils from "libs/utils";
import { coalesce } from "libs/utils";
import window from "libs/window";
import _ from "lodash";
import Navbar from "navbar";
import type React from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  type RouteProps,
} from "react-router-dom";
import { APICompoundTypeEnum, type APIMagRestrictions, TracingTypeEnum } from "types/api_types";
import { ControlModeEnum } from "viewer/constants";
import HelpButton from "viewer/view/help_modal";
import TracingLayoutView from "viewer/view/layouting/tracing_layout_view";

import AccountSettingsView from "admin/account/account_settings_view";
import {
  getDatasetIdFromNameAndOrganization,
  getOrganizationForDataset,
} from "admin/api/disambiguate_legacy_routes";
import VerifyEmailView from "admin/auth/verify_email_view";
import { DatasetURLImport } from "admin/dataset/dataset_url_import";
import TimeTrackingOverview from "admin/statistic/time_tracking_overview";
import AiModelListView from "admin/voxelytics/ai_model_list_view";
import { CheckCertificateModal } from "components/check_certificate_modal";
import ErrorBoundary from "components/error_boundary";
import { CheckTermsOfServices } from "components/terms_of_services_check";
import loadable from "libs/lazy_loader";
import type { EmptyObject } from "types/globals";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { Store } from "viewer/singletons";
import { CommandPalette } from "viewer/view/components/command_palette";

const { Content } = Layout;
import { useWkSelector } from "libs/react_hooks";

const AsyncWorkflowView = loadable<EmptyObject>(() => import("admin/voxelytics/workflow_view"));
const AsyncWorkflowListView = loadable<EmptyObject>(
  () => import("admin/voxelytics/workflow_list_view"),
);

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
            <Link to="/" key="return-to-dashboard">
              <Button>Back to Dashboard</Button>
            </Link>,
          ]}
        />
      </Col>
    </Row>
  );
}

const RouteWithErrorBoundary: React.FC<RouteProps> = (props) => {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <Route {...props} />
    </ErrorBoundary>
  );
};

const SecuredRouteWithErrorBoundary: React.FC<SecuredRouteProps> = (props) => {
  const location = useLocation();
  return (
    <ErrorBoundary key={location.pathname}>
      <SecuredRoute {...props} />
    </ErrorBoundary>
  );
};

function ReactRouter() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const hasOrganizations = useWkSelector((state) => state.uiInformation.hasOrganizations);
  const isAdminView = useWkSelector((state) => !state.uiInformation.isInAnnotationView);

  const location = useLocation();

  const tracingView = (type?: string, id?: string) => {
    const initialMaybeCompoundType = type != null ? coalesce(APICompoundTypeEnum, type) : null;

    return (
      <TracingLayoutView
        initialMaybeCompoundType={initialMaybeCompoundType}
        initialCommandType={{
          type: ControlModeEnum.TRACE,
          annotationId: id || "",
        }}
      />
    );
  };

  const tracingSandboxLegacy = (
    type: string,
    datasetName: string = "",
    organizationId: string = "",
  ) => {
    const tracingType = coalesce(TracingTypeEnum, type);
    if (tracingType == null) {
      return <h3>Invalid annotation URL.</h3>;
    }
    const getParams = Utils.getUrlParamsObjectFromString(location.search);
    return (
      <AsyncRedirect
        redirectTo={async () => {
          const datasetId = await getDatasetIdFromNameAndOrganization(
            datasetName,
            organizationId,
            getParams.token,
          );
          return `/datasets/${datasetName}-${datasetId}/sandbox/:${tracingType}${location.search}${location.hash}`;
        }}
      />
    );
  };

  const tracingSandbox = (type: string, datasetNameAndId: string) => {
    const tracingType = coalesce(TracingTypeEnum, type);
    const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
    const getParams = Utils.getUrlParamsObjectFromString(location.search);

    if (tracingType == null) {
      return <h3>Invalid annotation URL.</h3>;
    }
    if (datasetName) {
      // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
      // The schema is something like <authority>/datasets/:datasetName/sandbox/<type>
      return (
        <AsyncRedirect
          redirectTo={async () => {
            const organizationId = await getOrganizationForDataset(datasetName, getParams.token);
            const datasetId = await getDatasetIdFromNameAndOrganization(
              datasetName,
              organizationId,
              getParams.token,
            );
            return `/datasets/${datasetName}-${datasetId}/sandbox/${tracingType}${location.search}${location.hash}`;
          }}
        />
      );
    }
    return (
      <TracingLayoutView
        initialMaybeCompoundType={null}
        initialCommandType={{
          type: ControlModeEnum.SANDBOX,
          tracingType,
          datasetId: datasetId || "",
        }}
      />
    );
  };

  const tracingViewModeLegacy = (datasetName: string = "", organizationId: string = "") => {
    const getParams = Utils.getUrlParamsObjectFromString(location.search);
    return (
      <AsyncRedirect
        redirectTo={async () => {
          const datasetId = await getDatasetIdFromNameAndOrganization(
            datasetName,
            organizationId,
            getParams.token,
          );
          return `/datasets/${datasetName}-${datasetId}/view${location.search}${location.hash}`;
        }}
      />
    );
  };

  const tracingViewMode = (datasetNameAndId: string) => {
    const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
    const getParams = Utils.getUrlParamsObjectFromString(location.search);
    if (datasetName) {
      // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
      // The schema is something like <authority>/datasets/:datasetName/view
      return (
        <AsyncRedirect
          redirectTo={async () => {
            const organizationId = await getOrganizationForDataset(datasetName, getParams.token);
            const datasetId = await getDatasetIdFromNameAndOrganization(
              datasetName,
              organizationId,
              getParams.token,
            );
            return `/datasets/${datasetName}-${datasetId}/view${location.search}${location.hash}`;
          }}
        />
      );
    }
    return (
      <TracingLayoutView
        initialMaybeCompoundType={null}
        initialCommandType={{
          type: ControlModeEnum.VIEW,
          datasetId: datasetId || "",
        }}
      />
    );
  };

  const serverAuthenticationCallback = async (id: string) => {
    try {
      const annotationInformation = await getUnversionedAnnotationInformation(id || "");
      return annotationInformation.visibility === "Public";
    } catch (_ex) {
      // Annotation could not be found
    }

    return false;
  };

  const isAuthenticated = activeUser !== null;
  return (
    <BrowserRouter>
      <Layout>
        <DisableGenericDnd />
        <CheckCertificateModal />
        {
          /* within tracing view, the command palette is rendered in the status bar. */
          isAuthenticated && isAdminView && <CommandPalette label={null} />
        }
        <CheckTermsOfServices />
        <Navbar isAuthenticated={isAuthenticated} />
        <HelpButton />
        <Content>
          <Routes>
            <RouteWithErrorBoundary
              path="/"
              element={(() => {
                if (!hasOrganizations && !features().isWkorgInstance) {
                  return <Navigate to="/onboarding" />;
                }

                if (isAuthenticated) {
                  return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
                }

                return <Navigate to="/auth/login" />;
              })()}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/dashboard/:tab"
              element={(() => {
                const initialTabKey =
                  // @ts-ignore If tab does not exist in urlTokenToTabKeyMap, initialTabKey is still valid (i.e., undefined)
                  tab ? urlTokenToTabKeyMap[tab] : null;
                return (
                  <DashboardView userId={null} isAdminView={false} initialTabKey={initialTabKey} />
                );
              })()}
            />

            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/dashboard/datasets/:folderIdWithName"
              element={
                <DashboardView userId={null} isAdminView={false} initialTabKey={"datasets"} />
              }
            />

            <RouteWithErrorBoundary
              path="/dashboard"
              element={(() => {
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
              })()}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/users/:userId/details"
              requiresAdminOrManagerRole
              element={(() => {
                const { userId } = useParams();
                return (
                  <DashboardView
                    userId={userId}
                    isAdminView={userId !== null}
                    initialTabKey={null}
                  />
                );
              })()}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/users"
              element={<UserListView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/import"
              element={<DatasetURLImport />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/teams"
              element={<TeamListView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/timetracking"
              element={<TimeTrackingOverview />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              requiredPricingPlan={PricingPlanEnum.Team}
              path="/reports/projectProgress"
              element={<ProjectProgressReportView />}
              requiresAdminOrManagerRole
            />
            <RouteWithErrorBoundary
              path="/reports/openTasks"
              element={<Navigate to="/reports/availableTasks" />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              requiredPricingPlan={PricingPlanEnum.Team}
              path="/reports/availableTasks"
              element={<AvailableTasksReportView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/tasks"
              requiredPricingPlan={PricingPlanEnum.Team}
              element={<TaskListView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/tasks/create"
              requiredPricingPlan={PricingPlanEnum.Team}
              element={<TaskCreateView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/tasks/:taskId/edit"
              requiredPricingPlan={PricingPlanEnum.Team}
              requiresAdminOrManagerRole
              element={<TaskCreateFormView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/tasks/:taskId"
              requiredPricingPlan={PricingPlanEnum.Team}
              requiresAdminOrManagerRole
              element={<TaskListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/projects"
              requiredPricingPlan={PricingPlanEnum.Team}
              requiresAdminOrManagerRole
              element={<ProjectListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/projects/create"
              requiredPricingPlan={PricingPlanEnum.Team}
              requiresAdminOrManagerRole
              element={<ProjectCreateView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/projects/:projectId/tasks"
              requiredPricingPlan={PricingPlanEnum.Team}
              requiresAdminOrManagerRole
              element={<TaskListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/projects/:projectId/edit"
              requiredPricingPlan={PricingPlanEnum.Team}
              requiresAdminOrManagerRole
              element={<ProjectCreateView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/annotations/:type/:id"
              element={(() => {
                const { type, id } = useParams();
                const location = useLocation();
                const initialMaybeCompoundType =
                  type != null ? coalesce(APICompoundTypeEnum, type) : null;

                if (initialMaybeCompoundType == null) {
                  const { hash, search } = location;
                  return <Navigate to={`/annotations/${id}${search}${hash}`} />;
                }

                return tracingView({ type, id });
              })()}
              serverAuthenticationCallback={serverAuthenticationCallback}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/annotations/:id"
              element={(() => {
                const { id } = useParams();
                return tracingView({ id });
              })()}
              serverAuthenticationCallback={serverAuthenticationCallback}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/datasets/upload"
              requiresAdminOrManagerRole
              element={<DatasetAddView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/datasets/:datasetNameAndId/edit"
              requiresAdminOrManagerRole
              element={(() => {
                const { datasetNameAndId } = useParams();
                const { datasetId, datasetName } =
                  getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
                const getParams = Utils.getUrlParamsObjectFromString(location.search);
                if (datasetName) {
                  // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
                  // The schema is something like <authority>/datasets/:datasetName/edit
                  return (
                    <AsyncRedirect
                      redirectTo={async () => {
                        const organizationId = await getOrganizationForDataset(
                          datasetName,
                          getParams.token,
                        );
                        const datasetId = await getDatasetIdFromNameAndOrganization(
                          datasetName,
                          organizationId,
                          getParams.token,
                        );
                        return `/datasets/${datasetName}-${datasetId}/edit`;
                      }}
                    />
                  );
                }
                return (
                  <DatasetSettingsView
                    isEditingMode
                    datasetId={datasetId || ""}
                    onComplete={() => window.history.back()}
                    onCancel={() => window.history.back()}
                  />
                );
              })()}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/taskTypes"
              requiresAdminOrManagerRole
              element={<TaskTypeListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/taskTypes/create"
              requiredPricingPlan={PricingPlanEnum.Team}
              element={<TaskTypeCreateView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/taskTypes/:taskTypeId/edit"
              requiredPricingPlan={PricingPlanEnum.Team}
              element={<TaskTypeCreateView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/taskTypes/:taskTypeId/tasks"
              requiredPricingPlan={PricingPlanEnum.Team}
              element={<TaskListView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/taskTypes/:taskTypeId/projects"
              requiredPricingPlan={PricingPlanEnum.Team}
              element={<ProjectListView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/scripts/create"
              element={<ScriptCreateView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/scripts/:scriptId/edit"
              requiresAdminOrManagerRole
              element={<ScriptCreateView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/scripts"
              element={<ScriptListView />}
              requiresAdminOrManagerRole
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/jobs"
              element={<JobListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/organizations/:organizationId"
              element={<Navigate to="/organization" />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/organization"
              element={<OrganizationView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/organization/:tab"
              element={<OrganizationView />}
            />
            <RouteWithErrorBoundary
              path="/help/keyboardshortcuts"
              element={
                <Navigate to="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html" />
              }
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/auth/token"
              element={<Navigate to="/account/token" />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/auth/changePassword"
              element={<Navigate to="/account/password" />}
            />
            <RouteWithErrorBoundary path="/login" element={<Navigate to="/auth/login" />} />

            <RouteWithErrorBoundary
              path="/invite/:token"
              element={<AcceptInviteView activeUser={activeUser} />}
            />

            <RouteWithErrorBoundary path="/verifyEmail/:token" element={<VerifyEmailView />} />

            <RouteWithErrorBoundary path="/signup" element={<Navigate to="/auth/signup" />} />
            <RouteWithErrorBoundary path="/register" element={<Navigate to="/auth/signup" />} />
            <RouteWithErrorBoundary
              path="/auth/register"
              element={<Navigate to="/auth/signup" />}
            />
            <RouteWithErrorBoundary
              path="/auth/login"
              element={isAuthenticated ? <Navigate to="/" /> : <LoginView />}
            />
            <RouteWithErrorBoundary
              path="/auth/signup"
              element={isAuthenticated ? <Navigate to="/" /> : <RegistrationView />}
            />

            <RouteWithErrorBoundary
              path="/auth/resetPassword"
              element={<StartResetPasswordView />}
            />
            <RouteWithErrorBoundary
              path="/auth/finishResetPassword"
              element={<FinishResetPasswordView />}
            />
            {/* legacy view mode route */}
            <RouteWithErrorBoundary
              path="/datasets/:organizationId/:datasetName/view"
              element={tracingViewModeLegacy(useParams())}
            />
            <RouteWithErrorBoundary
              path="/datasets/:datasetNameAndId/view"
              element={tracingViewMode(useParams())}
            />
            <RouteWithErrorBoundary
              path="/datasets/:datasetNameAndId/sandbox/:type"
              element={tracingSandbox(useParams())}
            />
            {/* legacy sandbox route */}
            <RouteWithErrorBoundary
              path="/datasets/:organizationId/:datasetName/sandbox/:type"
              element={tracingSandboxLegacy(useParams())}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/datasets/:datasetId/createExplorative/:type"
              element={(() => {
                const { datasetId, type } = useParams();
                return (
                  <AsyncRedirect
                    pushToHistory={false}
                    redirectTo={async () => {
                      if (!datasetId || !type) {
                        // Typehint for TS
                        throw new Error("Invalid URL");
                      }

                      const tracingType =
                        coalesce(TracingTypeEnum, type) || TracingTypeEnum.skeleton;
                      const getParams = Utils.getUrlParamsObjectFromString(location.search);
                      const { autoFallbackLayer, fallbackLayerName } = getParams;
                      const magRestrictions: APIMagRestrictions = {};

                      if (getParams.minMag !== undefined) {
                        magRestrictions.min = Number.parseInt(getParams.minMag);

                        if (!_.isNumber(magRestrictions.min)) {
                          throw new Error("Invalid minMag parameter");
                        }

                        if (getParams.maxMag !== undefined) {
                          magRestrictions.max = Number.parseInt(getParams.maxMag);

                          if (!_.isNumber(magRestrictions.max)) {
                            throw new Error("Invalid maxMag parameter");
                          }
                        }
                      }

                      const annotation = await createExplorational(
                        datasetId,
                        tracingType,
                        !!autoFallbackLayer,
                        fallbackLayerName,
                        null,
                        magRestrictions,
                      );
                      return `/annotations/${annotation.id}`;
                    }}
                  />
                );
              })()}
            />
            {
              // Note that this route has to be beneath all others sharing the same prefix,
              // to avoid url mismatching
            }
            {/*legacy view mode route */}
            <RouteWithErrorBoundary
              path="/datasets/:organizationId/:datasetName"
              element={tracingViewModeLegacy(useParams())}
            />
            <RouteWithErrorBoundary
              path="/datasets/:datasetNameAndId"
              element={tracingViewMode(useParams())}
            />
            <RouteWithErrorBoundary path="/publications/:id" element={<PublicationDetailView />} />
            <Route path="/publication/:id">
              <Navigate to="/publications/:id" />
            </Route>
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/workflows"
              element={<AsyncWorkflowListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/aiModels"
              element={<AiModelListView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/workflows/:workflowName"
              element={<AsyncWorkflowView />}
            />
            <RouteWithErrorBoundary path="/imprint" element={<Imprint />} />
            <RouteWithErrorBoundary path="/privacy" element={<Privacy />} />
            <RouteWithErrorBoundary
              path="/links/:key"
              element={(() => {
                const { key } = useParams();
                return (
                  <AsyncRedirect
                    redirectTo={async () => {
                      const shortLink = await getShortLink(key);
                      return shortLink.longLink;
                    }}
                  />
                );
              })()}
            />
            {!features().isWkorgInstance && (
              <RouteWithErrorBoundary path="/onboarding" element={<Onboarding />} />
            )}
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/account"
              element={<AccountSettingsView />}
            />
            <SecuredRouteWithErrorBoundary
              isAuthenticated={isAuthenticated}
              path="/account/:tab"
              element={<AccountSettingsView />}
            />
            <RouteWithErrorBoundary path="*" element={<PageNotFoundView />} />
          </Routes>
        </Content>
      </Layout>
    </BrowserRouter>
  );
}

export default ReactRouter;
