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
import { Layout } from "antd";
import DisableGenericDnd from "components/disable_generic_dnd";
import { Imprint, Privacy } from "components/legal";
import AsyncRedirect from "components/redirect";
import SecuredRoute from "components/secured_route";
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
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
  type RouteProps,
} from "react-router-dom";
import { APICompoundTypeEnum, type APIMagRestrictions, TracingTypeEnum } from "types/api_types";
import HelpButton from "viewer/view/help_modal";

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
import {
  TracingSandboxLegacyRouteWrapper,
  TracingSandboxRouteWrapper,
  TracingViewModeLegacyWrapper,
  TracingViewModeRouteWrapper,
  TracingViewRouteWrapper,
} from "./tracing_view_route_wrappers";
import { PageNotFoundView } from "./page_not_found_view";

const AsyncWorkflowView = loadable<EmptyObject>(() => import("admin/voxelytics/workflow_view"));
const AsyncWorkflowListView = loadable<EmptyObject>(
  () => import("admin/voxelytics/workflow_list_view"),
);

const serverAuthenticationCallback = async (id: string) => {
  try {
    const annotationInformation = await getUnversionedAnnotationInformation(id || "");
    return annotationInformation.visibility === "Public";
  } catch (_ex) {
    // Annotation could not be found
  }

  return false;
};

function RootRoute({ isAuthenticated }: { isAuthenticated: boolean }) {
  const hasOrganizations = useWkSelector((state) => state.uiInformation.hasOrganizations);
  if (!hasOrganizations && !features().isWkorgInstance) {
    return <Navigate to="/onboarding" />;
  }

  if (isAuthenticated) {
    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
  }

  return <Navigate to="/auth/login" />;
}

function DashboardRoute() {
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
}

function ReactRouter() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const isAdminView = useWkSelector((state) => !state.uiInformation.isInAnnotationView);

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
            <Route errorElement={<ErrorBoundary />}>
              <Route path="/" exact element={<RootRoute isAuthenticated={isAuthenticated} />} />
              {/* <Route
    
    path="/dashboard/:tab"
    element={(() => {
      const { tab } = useParams();
      const initialTabKey =
        // @ts-ignore If tab does not exist in urlTokenToTabKeyMap, initialTabKey is still valid (i.e., undefined)
        tab ? urlTokenToTabKeyMap[tab] : null;
      return (
        <SecuredRoute><DashboardView userId={null} isAdminView={false} initialTabKey={initialTabKey} /></SecuredRoute>
      );
    })()}
  /> */}

              <Route
                path="/dashboard/datasets/:folderIdWithName"
                element={
                  <SecuredRoute>
                    <DashboardView userId={null} isAdminView={false} initialTabKey={"datasets"} />
                  </SecuredRoute>
                }
              />

              <Route path="/dashboard" element={<DashboardRoute />} />
              {/* <Route
                path="/users/:userId/details"
                element={(() => {
                  const { userId } = useParams();
                  return (
                    <SecuredRoute requiresAdminOrManagerRole>
                      <DashboardView
                        userId={userId}
                        isAdminView={userId !== null}
                        initialTabKey={null}
                      />
                    </SecuredRoute>
                  );
                })()}
              /> */}
              <Route
                path="/users"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <UserListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/import"
                element={
                  <SecuredRoute>
                    <DatasetURLImport />
                  </SecuredRoute>
                }
              />
              <Route
                path="/teams"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <TeamListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/timetracking"
                element={
                  <SecuredRoute>
                    <TimeTrackingOverview />
                  </SecuredRoute>
                }
              />
              <Route
                path="/reports/projectProgress"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <ProjectProgressReportView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/reports/openTasks"
                element={<Navigate to="/reports/availableTasks" />}
              />
              <Route
                path="/reports/availableTasks"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <AvailableTasksReportView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/tasks"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/tasks/create"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskCreateView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/tasks/:taskId/edit"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskCreateFormView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/tasks/:taskId"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/projects"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <ProjectListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/projects/create"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <ProjectCreateView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/projects/:projectId/tasks"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/projects/:projectId/edit"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <ProjectCreateView />
                  </SecuredRoute>
                }
              />
              {/* <Route
    
    path="/annotations/:type/:id"
    element={(()<SecuredRoute> => </SecuredRoute>{
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
  /> */}
              <Route
                path="/annotations/:id"
                element={
                  <SecuredRoute serverAuthenticationCallback={serverAuthenticationCallback}>
                    <TracingViewRouteWrapper />
                  </SecuredRoute>
                }
              />
              <Route
                path="/datasets/upload"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <DatasetAddView />
                  </SecuredRoute>
                }
              />
              {/* <Route
    
    path="/datasets/:datasetNameAndId/edit"
    
    element={(() => {
      const { datasetNameAndId } = useParams();
      const { datasetId, datasetName } =
        getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
      const getParams = Utils.getUrlParamsObjectFromString(location.search);
      if (datasetName) {
        // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
        // The schema is something like <authority>/datasets/:datasetName/edit
        return (
        <SecuredRoute>
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
      <SecuredRoute requiresAdminOrManagerRole>
        <DatasetSettingsView
          isEditingMode
          datasetId={datasetId || ""}
          onComplete={() => window.history.back()}
          onCancel={() => window.history.back()}
        />
        </SecuredRoute>
      );
    })()}
  /> */}
              <Route
                path="/taskTypes"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <TaskTypeListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/taskTypes/create"
                element={
                  <SecuredRoute
                    requiresAdminOrManagerRole
                    requiredPricingPlan={PricingPlanEnum.Team}
                  >
                    <TaskTypeCreateView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/taskTypes/:taskTypeId/edit"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskTypeCreateView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/taskTypes/:taskTypeId/tasks"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <TaskListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/taskTypes/:taskTypeId/projects"
                element={
                  <SecuredRoute
                    requiredPricingPlan={PricingPlanEnum.Team}
                    requiresAdminOrManagerRole
                  >
                    <ProjectListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/scripts/create"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <ScriptCreateView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/scripts/:scriptId/edit"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <ScriptCreateView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/scripts"
                element={
                  <SecuredRoute requiresAdminOrManagerRole>
                    <ScriptListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/jobs"
                element={
                  <SecuredRoute>
                    <JobListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/organizations/:organizationId"
                element={<Navigate to="/organization" />}
              />
              <Route
                path="/organization"
                element={
                  <SecuredRoute>
                    <OrganizationView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/organization/:tab"
                element={
                  <SecuredRoute>
                    <OrganizationView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/help/keyboardshortcuts"
                element={
                  <Navigate to="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html" />
                }
              />
              {/* Backwards compatibility for old auth token URLs */}
              <Route path="/auth/token" element={<Navigate to="/account/token" />} />
              {/* Backwards compatibility for old password change URLs */}
              <Route path="/auth/changePassword" element={<Navigate to="/account/password" />} />
              <Route path="/login" element={<Navigate to="/auth/login" />} />

              <Route path="/invite/:token" element={<AcceptInviteView activeUser={activeUser} />} />

              <Route path="/verifyEmail/:token" element={<VerifyEmailView />} />

              <Route path="/signup" element={<Navigate to="/auth/signup" />} />
              <Route path="/register" element={<Navigate to="/auth/signup" />} />
              <Route path="/auth/register" element={<Navigate to="/auth/signup" />} />
              <Route
                path="/auth/login"
                element={isAuthenticated ? <Navigate to="/" /> : <LoginView />}
              />
              <Route
                path="/auth/signup"
                element={isAuthenticated ? <Navigate to="/" /> : <RegistrationView />}
              />

              <Route path="/auth/resetPassword" element={<StartResetPasswordView />} />
              <Route path="/auth/finishResetPassword" element={<FinishResetPasswordView />} />
              {/* legacy view mode route */}
              <Route
                path="/datasets/:organizationId/:datasetName/view"
                element={<TracingViewModeLegacyWrapper />}
              />
              <Route
                path="/datasets/:datasetNameAndId/view"
                element={<TracingViewModeRouteWrapper />}
              />
              <Route
                path="/datasets/:datasetNameAndId/sandbox/:type"
                element={<TracingSandboxRouteWrapper />}
              />
              {/* legacy sandbox route */}
              <Route
                path="/datasets/:organizationId/:datasetName/sandbox/:type"
                element={<TracingSandboxLegacyRouteWrapper />}
              />
              {/* <Route
    
    path="/datasets/:datasetId/createExplorative/:type"
    element={(() => 
      const { datasetId, type } = useParams();
      return (
      <SecuredRoute>
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
        /></SecuredRoute>
      );
    })()}
  /> */}
              {
                // Note that this route has to be beneath all others sharing the same prefix,
                // to avoid url mismatching
              }
              {/*legacy view mode route */}
              <Route
                path="/datasets/:organizationId/:datasetName"
                element={<TracingViewModeLegacyWrapper />}
              />
              <Route path="/datasets/:datasetNameAndId" element={<TracingViewModeRouteWrapper />} />
              <Route path="/publications/:id" element={<PublicationDetailView />} />
              <Route path="/publication/:id" element={<Navigate to="/publications/:id" />} />
              <Route
                path="/workflows"
                element={
                  <SecuredRoute>
                    <AsyncWorkflowListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/aiModels"
                element={
                  <SecuredRoute>
                    <AiModelListView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/workflows/:workflowName"
                element={
                  <SecuredRoute>
                    <AsyncWorkflowView />
                  </SecuredRoute>
                }
              />
              <Route path="/imprint" element={<Imprint />} />
              <Route path="/privacy" element={<Privacy />} />
              {/* <Route
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
  /> */}
              {!features().isWkorgInstance && <Route path="/onboarding" element={<Onboarding />} />}
              <Route
                path="/account"
                element={
                  <SecuredRoute>
                    <AccountSettingsView />
                  </SecuredRoute>
                }
              />
              <Route
                path="/account/:tab"
                element={
                  <SecuredRoute>
                    <AccountSettingsView />
                  </SecuredRoute>
                }
              />
              <Route path="*" element={<PageNotFoundView />} />
            </Route>
          </Routes>
        </Content>
      </Layout>
    </BrowserRouter>
  );
}

export default ReactRouter;
