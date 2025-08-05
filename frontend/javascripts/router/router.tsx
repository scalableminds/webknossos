import AcceptInviteView from "admin/auth/accept_invite_view";
import FinishResetPasswordView from "admin/auth/finish_reset_password_view";
import LoginView from "admin/auth/login_view";
import RegistrationView from "admin/auth/registration_view";
import StartResetPasswordView from "admin/auth/start_reset_password_view";
import DatasetAddView from "admin/dataset/dataset_add_view";
import JobListView from "admin/job/job_list_view";
import OrganizationView from "admin/organization/organization_view";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
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
import { Layout } from "antd";
import { Imprint, Privacy } from "components/legal";
import SecuredRoute from "components/secured_route";
import DashboardView from "dashboard/dashboard_view";
import PublicationDetailView from "dashboard/publication_details_view";
import Navbar from "navbar";
import {
  Navigate,
  Outlet,
  Route,
  createBrowserRouter,
  createRoutesFromElements,
} from "react-router-dom";

import AccountSettingsView from "admin/account/account_settings_view";
import VerifyEmailView from "admin/auth/verify_email_view";
import { DatasetURLImport } from "admin/dataset/dataset_url_import";
import TimeTrackingOverview from "admin/statistic/time_tracking_overview";
import AiModelListView from "admin/voxelytics/ai_model_list_view";
import ErrorBoundary from "components/error_boundary";
import loadable from "libs/lazy_loader";
import type { EmptyObject } from "types/globals";
import { CommandPalette } from "viewer/view/components/command_palette";

const { Content } = Layout;
import AccountAuthTokenView from "admin/account/account_auth_token_view";
import AccountPasswordView from "admin/account/account_password_view";
import AccountProfileView from "admin/account/account_profile_view";
import ChangeEmailView from "admin/auth/change_email_view";
import { OrganizationDangerZoneView } from "admin/organization/organization_danger_zone_view";
import { OrganizationNotificationsView } from "admin/organization/organization_notifications_view";
import { OrganizationOverviewView } from "admin/organization/organization_overview_view";
import DatasetSettingsDataTab from "dashboard/dataset/dataset_settings_data_tab";
import DatasetSettingsDeleteTab from "dashboard/dataset/dataset_settings_delete_tab";
import DatasetSettingsMetadataTab from "dashboard/dataset/dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "dashboard/dataset/dataset_settings_sharing_tab";
import DatasetSettingsViewConfigTab from "dashboard/dataset/dataset_settings_viewconfig_tab";
import { useWkSelector } from "libs/react_hooks";
import { PageNotFoundView } from "./page_not_found_view";
import {
  AnnotationsRouteWrapper,
  CreateExplorativeRouteWrapper,
  DashboardRouteRootWrapper,
  DashboardRouteWrapper,
  DatasetSettingsRouteWrapper,
  OnboardingRouteWrapper,
  RootRouteWrapper,
  ShortLinksRouteWrapper,
  TracingSandboxLegacyRouteWrapper,
  TracingSandboxRouteWrapper,
  TracingViewModeLegacyWrapper,
  TracingViewModeRouteWrapper,
  TracingViewRouteWrapper,
  UserDetailsRouteWrapper,
} from "./route_wrappers";

const AsyncWorkflowView = loadable<EmptyObject>(() => import("admin/voxelytics/workflow_view"));
const AsyncWorkflowListView = loadable<EmptyObject>(
  () => import("admin/voxelytics/workflow_list_view"),
);

function RootLayout() {
  const isAuthenticated = useWkSelector((state) => state.activeUser != null);
  const isAdminView = useWkSelector((state) => !state.uiInformation.isInAnnotationView);

  return (
    <Layout>
      {/* TODO: always show command palette; remove logic from router
      within tracing view, the command palette is rendered in the status bar. */}
      {isAuthenticated && isAdminView && <CommandPalette label={null} />}
      <Navbar isAuthenticated={isAuthenticated} />
      <Content>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </Content>
    </Layout>
  );
}

const routes = createRoutesFromElements(
  <Route element={<RootLayout />}>
    <Route path="/" element={<RootRouteWrapper />} />
    <Route
      path="/dashboard/:tab"
      element={
        <SecuredRoute>
          <DashboardRouteWrapper />
        </SecuredRoute>
      }
    />

    <Route
      path="/dashboard/datasets/:folderIdWithName"
      element={
        <SecuredRoute>
          <DashboardView userId={null} isAdminView={false} initialTabKey={"datasets"} />
        </SecuredRoute>
      }
    />

    <Route path="/dashboard" element={<DashboardRouteRootWrapper />} />
    <Route
      path="/users/:userId/details"
      element={
        <SecuredRoute requiresAdminOrManagerRole>
          <UserDetailsRouteWrapper />
        </SecuredRoute>
      }
    />
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
        <SecuredRoute requiresAdminOrManagerRole>
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
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <ProjectProgressReportView />
        </SecuredRoute>
      }
    />
    <Route path="/reports/openTasks" element={<Navigate to="/reports/availableTasks" />} />
    <Route
      path="/reports/availableTasks"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <AvailableTasksReportView />
        </SecuredRoute>
      }
    />
    <Route
      path="/tasks"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskListView />
        </SecuredRoute>
      }
    />
    <Route
      path="/tasks/create"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskCreateView />
        </SecuredRoute>
      }
    />
    <Route
      path="/tasks/:taskId/edit"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskCreateFormView />
        </SecuredRoute>
      }
    />
    <Route
      path="/tasks/:taskId"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskListView />
        </SecuredRoute>
      }
    />
    <Route
      path="/projects"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <ProjectListView />
        </SecuredRoute>
      }
    />
    <Route
      path="/projects/create"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <ProjectCreateView />
        </SecuredRoute>
      }
    />
    <Route
      path="/projects/:projectId/tasks"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskListView />
        </SecuredRoute>
      }
    />
    <Route
      path="/projects/:projectId/edit"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <ProjectCreateView />
        </SecuredRoute>
      }
    />
    <Route
      path="/annotations/:type/:id"
      element={
        <SecuredRoute checkIfResourceIsPublic>
          <AnnotationsRouteWrapper />
        </SecuredRoute>
      }
    />
    <Route
      path="/annotations/:id"
      element={
        <SecuredRoute checkIfResourceIsPublic>
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

    <Route
      path="/datasets/:datasetNameAndId/edit"
      element={
        <SecuredRoute requiresAdminOrManagerRole>
          <DatasetSettingsRouteWrapper />
        </SecuredRoute>
      }
    >
      <Route index element={<Navigate to="data" />} />
      <Route path="data" element={<DatasetSettingsDataTab />} />
      <Route path="sharing" element={<DatasetSettingsSharingTab />} />
      <Route path="metadata" element={<DatasetSettingsMetadataTab />} />
      <Route path="defaultConfig" element={<DatasetSettingsViewConfigTab />} />
      <Route path="delete" element={<DatasetSettingsDeleteTab />} />
    </Route>
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
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskTypeCreateView />
        </SecuredRoute>
      }
    />
    <Route
      path="/taskTypes/:taskTypeId/edit"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskTypeCreateView />
        </SecuredRoute>
      }
    />
    <Route
      path="/taskTypes/:taskTypeId/tasks"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
          <TaskListView />
        </SecuredRoute>
      }
    />
    <Route
      path="/taskTypes/:taskTypeId/projects"
      element={
        <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
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
    <Route path="/organizations/:organizationId" element={<Navigate to="/organization" />} />
    <Route
      path="/organization"
      element={
        <SecuredRoute>
          <OrganizationView />
        </SecuredRoute>
      }
    >
      <Route index element={<Navigate to="overview" />} />
      <Route path="overview" element={<OrganizationOverviewView />} />
      <Route path="notifications" element={<OrganizationNotificationsView />} />
      <Route path="delete" element={<OrganizationDangerZoneView />} />
    </Route>
    <Route
      path="/help/keyboardshortcuts"
      element={<Navigate to="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html" />}
    />
    {/* Backwards compatibility for old auth token URLs */}
    <Route path="/auth/token" element={<Navigate to="/account/token" />} />
    {/* Backwards compatibility for old password change URLs */}
    <Route path="/auth/changePassword" element={<Navigate to="/account/password" />} />
    <Route path="/login" element={<Navigate to="/auth/login" />} />

    <Route path="/invite/:token" element={<AcceptInviteView />} />

    <Route path="/verifyEmail/:token" element={<VerifyEmailView />} />
    {/* Backwards compatibility for signup URLs */}
    <Route path="/signup" element={<Navigate to="/auth/signup" />} />
    {/* Backwards compatibility for register URLs */}
    <Route path="/register" element={<Navigate to="/auth/signup" />} />
    {/* Backwards compatibility for register URLs */}
    <Route path="/auth/register" element={<Navigate to="/auth/signup" />} />
    <Route path="/auth/login" element={<LoginView />} />
    <Route path="/auth/signup" element={<RegistrationView />} />

    <Route path="/auth/resetPassword" element={<StartResetPasswordView />} />
    <Route path="/auth/finishResetPassword" element={<FinishResetPasswordView />} />
    <Route
      path="/auth/changeEmail"
      element={
        <SecuredRoute>
          <ChangeEmailView />
        </SecuredRoute>
      }
    />
    {/* legacy view mode route */}
    <Route
      path="/datasets/:organizationId/:datasetName/view"
      element={<TracingViewModeLegacyWrapper />}
    />
    <Route path="/datasets/:datasetNameAndId/view" element={<TracingViewModeRouteWrapper />} />
    <Route
      path="/datasets/:datasetNameAndId/sandbox/:type"
      element={<TracingSandboxRouteWrapper />}
    />
    {/* legacy sandbox route */}
    <Route
      path="/datasets/:organizationId/:datasetName/sandbox/:type"
      element={<TracingSandboxLegacyRouteWrapper />}
    />
    <Route
      path="/datasets/:datasetId/createExplorative/:type"
      element={
        <SecuredRoute>
          <CreateExplorativeRouteWrapper />
        </SecuredRoute>
      }
    />
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
    <Route path="/links/:key" element={<ShortLinksRouteWrapper />} />
    <Route path="/onboarding" element={<OnboardingRouteWrapper />} />
    <Route
      path="/account"
      element={
        <SecuredRoute>
          <AccountSettingsView />
        </SecuredRoute>
      }
    >
      <Route index element={<Navigate to="profile" />} />
      <Route path="profile" element={<AccountProfileView />} />
      <Route path="password" element={<AccountPasswordView />} />
      <Route path="token" element={<AccountAuthTokenView />} />
    </Route>
    <Route path="*" element={<PageNotFoundView />} />
  </Route>,
);

const router = createBrowserRouter(routes);
export default router;
