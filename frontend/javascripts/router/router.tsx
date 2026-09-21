import AccountSettingsView from "admin/account/account_settings_view";
import AcceptInviteView from "admin/auth/accept_invite_view";
import FinishResetPasswordView from "admin/auth/finish_reset_password_view";
import LoginView from "admin/auth/login_view";
import RegistrationView from "admin/auth/registration_view";
import StartResetPasswordView from "admin/auth/start_reset_password_view";
import VerifyEmailView from "admin/auth/verify_email_view";
import DatasetAddView from "admin/dataset/dataset_add_view";
import { DatasetURLImport, datasetURLImportLoader } from "admin/dataset/dataset_url_import";
import JobListView from "admin/job/job_list_view";
import OrganizationView from "admin/organization/organization_view";
import { PricingPlanEnum } from "admin/organization/pricing_plan_utils";
import ProjectCreateView from "admin/project/project_create_view";
import ProjectListView from "admin/project/project_list_view";
import ScriptCreateView from "admin/scripts/script_create_view";
import ScriptListView from "admin/scripts/script_list_view";
import AvailableTasksReportView from "admin/statistic/available_tasks_report_view";
import ProjectProgressReportView from "admin/statistic/project_progress_report_view";
import TimeTrackingOverview from "admin/statistic/time_tracking_overview";
import TaskCreateFormView from "admin/task/task_create_form_view";
import TaskCreateView from "admin/task/task_create_view";
import TaskListView from "admin/task/task_list_view";
import TaskTypeCreateView from "admin/tasktype/task_type_create_view";
import TaskTypeListView from "admin/tasktype/task_type_list_view";
import TeamListView from "admin/team/team_list_view";
import UserListView from "admin/user/user_list_view";
import AiModelListView from "admin/voxelytics/ai_model_list_view";
import { Layout } from "antd";
import ErrorBoundary from "components/error_boundary";
import { Imprint, Privacy } from "components/legal";
import SecuredRoute from "components/secured_route";
import DashboardView from "dashboard/dashboard_view";
import PublicationDetailView from "dashboard/publication_details_view";
import loadable from "libs/lazy_loader";
import Navbar from "navbar";
import { createBrowserRouter, Navigate, Outlet, type RouteObject, redirect } from "react-router";
import type { EmptyObject } from "types/type_utils";
import { CommandPalette } from "viewer/view/components/command_palette";

const { Content } = Layout;

import AccountAuthTokenView from "admin/account/account_auth_token_view";
import AccountProfileView from "admin/account/account_profile_view";
import AccountSecurityView from "admin/account/account_security_view";
import { OrganizationCreditActivityView } from "admin/organization/organization_credit_activity_view";
import { OrganizationDangerZoneView } from "admin/organization/organization_danger_zone_view";
import { OrganizationNotificationsView } from "admin/organization/organization_notifications_view";
import { OrganizationOverviewView } from "admin/organization/organization_overview_view";
import { OrganizationPlanActivityView } from "admin/organization/organization_plan_activity_view";
import DatasetSettingsDataTab from "dashboard/dataset/dataset_settings_data_tab";
import DatasetSettingsDeleteTab from "dashboard/dataset/dataset_settings_delete_tab";
import DatasetSettingsMetadataTab from "dashboard/dataset/dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "dashboard/dataset/dataset_settings_sharing_tab";
import DatasetSettingsStorageTab from "dashboard/dataset/dataset_settings_storage_tab";
import DatasetSettingsViewConfigTab from "dashboard/dataset/dataset_settings_viewconfig_tab";
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
  return (
    <Layout>
      <CommandPalette />
      <Navbar />
      <Content>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </Content>
    </Layout>
  );
}

const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    children: [
      { path: "/", element: <RootRouteWrapper /> },
      {
        path: "/dashboard/:tab",
        element: (
          <SecuredRoute>
            <DashboardRouteWrapper />
          </SecuredRoute>
        ),
      },
      {
        path: "/dashboard/datasets/:folderIdWithName",
        element: (
          <SecuredRoute>
            <DashboardView userId={null} isAdminView={false} initialTabKey={"datasets"} />
          </SecuredRoute>
        ),
      },
      { path: "/dashboard", element: <DashboardRouteRootWrapper /> },
      {
        path: "/users/:userId/details",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <UserDetailsRouteWrapper />
          </SecuredRoute>
        ),
      },
      {
        path: "/users",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <UserListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/import",
        loader: datasetURLImportLoader,
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <DatasetURLImport />
          </SecuredRoute>
        ),
      },
      {
        path: "/teams",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <TeamListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/timetracking",
        element: (
          <SecuredRoute>
            <TimeTrackingOverview />
          </SecuredRoute>
        ),
      },
      {
        path: "/reports/projectProgress",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <ProjectProgressReportView />
          </SecuredRoute>
        ),
      },
      { path: "/reports/openTasks", element: <Navigate to="/reports/availableTasks" replace /> },
      {
        path: "/reports/availableTasks",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <AvailableTasksReportView />
          </SecuredRoute>
        ),
      },
      {
        path: "/tasks",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/tasks/create",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/tasks/:taskId/edit",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskCreateFormView />
          </SecuredRoute>
        ),
      },
      {
        path: "/tasks/:taskId",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/projects",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <ProjectListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/projects/create",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <ProjectCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/projects/:projectId/tasks",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/projects/:projectId/edit",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <ProjectCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/annotations/:type/:id",
        element: (
          <SecuredRoute checkIfResourceIsPublic>
            <AnnotationsRouteWrapper />
          </SecuredRoute>
        ),
      },
      {
        path: "/annotations/:id",
        element: (
          <SecuredRoute checkIfResourceIsPublic>
            <TracingViewRouteWrapper />
          </SecuredRoute>
        ),
      },
      {
        path: "/datasets/upload",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <DatasetAddView />
          </SecuredRoute>
        ),
      },
      {
        path: "/datasets/:datasetNameAndId/edit",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <DatasetSettingsRouteWrapper />
          </SecuredRoute>
        ),
        children: [
          { index: true, element: <Navigate to="data" replace /> },
          { path: "data", element: <DatasetSettingsDataTab /> },
          { path: "sharing", element: <DatasetSettingsSharingTab /> },
          { path: "metadata", element: <DatasetSettingsMetadataTab /> },
          { path: "defaultConfig", element: <DatasetSettingsViewConfigTab /> },
          { path: "storage", element: <DatasetSettingsStorageTab /> },
          { path: "delete", element: <DatasetSettingsDeleteTab /> },
        ],
      },
      {
        path: "/taskTypes",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <TaskTypeListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/taskTypes/create",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskTypeCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/taskTypes/:taskTypeId/edit",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskTypeCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/taskTypes/:taskTypeId/tasks",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <TaskListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/taskTypes/:taskTypeId/projects",
        element: (
          <SecuredRoute requiresAdminOrManagerRole requiredPricingPlan={PricingPlanEnum.Team}>
            <ProjectListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/scripts/create",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <ScriptCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/scripts/:scriptId/edit",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <ScriptCreateView />
          </SecuredRoute>
        ),
      },
      {
        path: "/scripts",
        element: (
          <SecuredRoute requiresAdminOrManagerRole>
            <ScriptListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/jobs",
        element: (
          <SecuredRoute>
            <JobListView />
          </SecuredRoute>
        ),
      },
      { path: "/organizations/:organizationId", element: <Navigate to="/organization" replace /> },
      {
        path: "/organization",
        element: (
          <SecuredRoute>
            <OrganizationView />
          </SecuredRoute>
        ),
        children: [
          { index: true, element: <Navigate to="overview" replace /> },
          { path: "overview", element: <OrganizationOverviewView /> },
          { path: "notifications", element: <OrganizationNotificationsView /> },
          { path: "credit-activity", element: <OrganizationCreditActivityView /> },
          { path: "planupdates", element: <OrganizationPlanActivityView /> },
          { path: "delete", element: <OrganizationDangerZoneView /> },
        ],
      },
      {
        path: "/help/keyboardshortcuts",
        loader: () => redirect("https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"),
      },
      // Backwards compatibility for old auth token URLs
      { path: "/auth/token", element: <Navigate to="/account/token" replace /> },
      // Backwards compatibility for old password change URLs
      { path: "/auth/changePassword", element: <Navigate to="/account/security" replace /> },
      { path: "/account/password", element: <Navigate to="/account/security" replace /> },
      { path: "/login", element: <Navigate to="/auth/login" replace /> },

      { path: "/invite/:token", element: <AcceptInviteView /> },

      { path: "/verifyEmail/:token", element: <VerifyEmailView /> },
      // Backwards compatibility for signup URLs
      { path: "/signup", element: <Navigate to="/auth/signup" replace /> },
      // Backwards compatibility for register URLs
      { path: "/register", element: <Navigate to="/auth/signup" replace /> },
      // Backwards compatibility for register URLs
      { path: "/auth/register", element: <Navigate to="/auth/signup" replace /> },
      { path: "/auth/login", element: <LoginView /> },
      { path: "/auth/signup", element: <RegistrationView /> },

      { path: "/auth/resetPassword", element: <StartResetPasswordView /> },
      { path: "/auth/finishResetPassword", element: <FinishResetPasswordView /> },
      // legacy view mode route
      {
        path: "/datasets/:organizationId/:datasetName/view",
        element: <TracingViewModeLegacyWrapper />,
      },
      { path: "/datasets/:datasetNameAndId/view", element: <TracingViewModeRouteWrapper /> },
      {
        path: "/datasets/:datasetNameAndId/sandbox/:type",
        element: <TracingSandboxRouteWrapper />,
      },
      // legacy sandbox route
      {
        path: "/datasets/:organizationId/:datasetName/sandbox/:type",
        element: <TracingSandboxLegacyRouteWrapper />,
      },
      {
        path: "/datasets/:datasetId/createExplorative/:type",
        element: (
          <SecuredRoute>
            <CreateExplorativeRouteWrapper />
          </SecuredRoute>
        ),
      },
      // Note that the following two routes have to be beneath all others sharing the same prefix,
      // to avoid url mismatching.
      // legacy view mode route
      { path: "/datasets/:organizationId/:datasetName", element: <TracingViewModeLegacyWrapper /> },
      { path: "/datasets/:datasetNameAndId", element: <TracingViewModeRouteWrapper /> },
      { path: "/publications/:id", element: <PublicationDetailView /> },
      {
        path: "/publication/:id",
        loader: ({ params }) => redirect(`/publications/${params.id}`),
      },
      {
        path: "/workflows",
        element: (
          <SecuredRoute>
            <AsyncWorkflowListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/aiModels",
        element: (
          <SecuredRoute>
            <AiModelListView />
          </SecuredRoute>
        ),
      },
      {
        path: "/workflows/:workflowHash",
        loader: ({ params, request }) => {
          const url = new URL(request.url);
          const runId = url.searchParams.get("runId");
          if (runId) {
            url.searchParams.delete("runId");
            const search = url.searchParams.toString();

            return redirect(
              `/workflows/${params.workflowHash}/run/${encodeURIComponent(runId)}${search ? `?${search}` : ""}`,
            );
          }
          return null;
        },
        element: (
          <SecuredRoute>
            <AsyncWorkflowView />
          </SecuredRoute>
        ),
      },
      {
        path: "/workflows/:workflowHash/run/:runId",
        element: (
          <SecuredRoute>
            <AsyncWorkflowView />
          </SecuredRoute>
        ),
      },
      { path: "/imprint", element: <Imprint /> },
      { path: "/privacy", element: <Privacy /> },
      { path: "/links/:key", element: <ShortLinksRouteWrapper /> },
      { path: "/onboarding", element: <OnboardingRouteWrapper /> },
      {
        path: "/account",
        element: (
          <SecuredRoute>
            <AccountSettingsView />
          </SecuredRoute>
        ),
        children: [
          { index: true, element: <Navigate to="profile" replace /> },
          { path: "profile", element: <AccountProfileView /> },
          { path: "security", element: <AccountSecurityView /> },
          { path: "token", element: <AccountAuthTokenView /> },
        ],
      },
      { path: "*", element: <PageNotFoundView /> },
    ],
  },
];

const router = createBrowserRouter(routes);
export default router;
