import {
  getDatasetIdFromNameAndOrganization,
  getOrganizationForDataset,
} from "admin/api/disambiguate_legacy_routes";
import { createExplorational, getShortLink } from "admin/rest_api";
import { Typography } from "antd";
import AsyncRedirect from "components/redirect";
import { urlTokenToTabKeyMap } from "dashboard/dashboard_tab_keys";
import features from "features";
import loadable from "libs/lazy_loader";
import { useWkSelector } from "libs/react_hooks";
import { coalesce, getUrlParamsObjectFromString } from "libs/utils";
import window from "libs/window";
import isNumber from "lodash-es/isNumber";
import { useEffect } from "react";
import { Navigate, useLocation, useParams } from "react-router";
import { APICompoundTypeEnum, type APIMagRestrictions, TracingTypeEnum } from "types/api_types";
import { ControlModeEnum, PerformanceMarkEnum } from "viewer/constants";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { Store } from "viewer/singletons";
import { PageNotFoundView } from "./page_not_found_view";

// Loaded on demand for the same reason as the pages in router.tsx: these are whole
// application screens that the initial render never needs.
const Onboarding = loadable(() => import("admin/onboarding"));
const DashboardView = loadable(() => import("dashboard/dashboard_view"));
const DatasetSettingsScreen = loadable(() => import("dashboard/dataset/dataset_settings_screen"));
// The annotation viewer is by far the largest screen in the app - it reaches three.js, the
// shaders, the geometries and the flexlayout-based layouting. Loading it on demand keeps all
// of that out of the login screen, the dashboard and every admin page.
const TracingLayoutView = loadable(() => import("viewer/view/layouting/tracing_layout_view"));

function markTracingViewLoadStartEffect() {
  const markName = PerformanceMarkEnum.TRACING_VIEW_LOAD;
  performance.mark(markName);
  return () => performance.clearMarks(markName);
}

export function RootRouteWrapper() {
  const isAuthenticated = useWkSelector((state) => state.activeUser != null);
  const hasOrganizations = useWkSelector((state) => state.uiInformation.hasOrganizations);

  if (!hasOrganizations && !features()?.isWkorgInstance) {
    return <Navigate to="/onboarding" />;
  }

  if (isAuthenticated) {
    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
  }

  return <Navigate to="/auth/login" />;
}

export function DashboardRouteRootWrapper() {
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

export function DashboardRouteWrapper() {
  const { tab } = useParams();
  const initialTabKey =
    // @ts-expect-error If tab does not exist in urlTokenToTabKeyMap, initialTabKey is still valid (i.e., undefined)
    tab ? urlTokenToTabKeyMap[tab] : null;
  return <DashboardView userId={null} isAdminView={false} initialTabKey={initialTabKey} />;
}

export function UserDetailsRouteWrapper() {
  const { userId } = useParams();
  return <DashboardView userId={userId} isAdminView={userId !== null} initialTabKey={null} />;
}

export function AnnotationsRouteWrapper() {
  const { type, id } = useParams();
  const location = useLocation();
  const initialMaybeCompoundType = type != null ? coalesce(APICompoundTypeEnum, type) : null;

  if (initialMaybeCompoundType == null) {
    const { hash, search } = location;
    return <Navigate to={`/annotations/${id}${search}${hash}`} />;
  }

  return <TracingViewRouteWrapper />;
}

export function DatasetSettingsRouteWrapper() {
  const { datasetNameAndId = "" } = useParams();
  const location = useLocation();
  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = getUrlParamsObjectFromString(location.search);
  if (datasetName) {
    // Handle very old legacy URLs which neither have a datasetId nor an organizationId.
    // The schema is something like <authority>/datasets/:datasetName/edit
    return (
      <AsyncRedirect
        redirectTo={async () => {
          const organizationId = await getOrganizationForDataset(datasetName, getParams.token);
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
  return <DatasetSettingsScreen datasetId={datasetId || ""} />;
}

export function CreateExplorativeRouteWrapper() {
  const { datasetId, type } = useParams();
  const location = useLocation();

  return (
    <AsyncRedirect
      pushToHistory={false}
      redirectTo={async () => {
        if (!datasetId || !type) {
          // Typehint for TS
          throw new Error("Invalid URL");
        }

        const tracingType = coalesce(TracingTypeEnum, type) || TracingTypeEnum.skeleton;
        const { autoFallbackLayer, fallbackLayerName, minMag, maxMag } =
          getUrlParamsObjectFromString(location.search);
        const magRestrictions: APIMagRestrictions = {};

        if (minMag !== undefined) {
          magRestrictions.min = Number.parseInt(minMag, 10);

          if (!isNumber(magRestrictions.min)) {
            throw new Error("Invalid minMag parameter");
          }

          if (maxMag !== undefined) {
            magRestrictions.max = Number.parseInt(maxMag, 10);

            if (!isNumber(magRestrictions.max)) {
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
}

export function ShortLinksRouteWrapper() {
  const { key = "" } = useParams();
  return (
    <AsyncRedirect
      redirectTo={async () => {
        const shortLink = await getShortLink(key);
        return shortLink.longLink;
      }}
    />
  );
}

export function TracingViewRouteWrapper() {
  const { type, id } = useParams();
  const initialMaybeCompoundType = type != null ? coalesce(APICompoundTypeEnum, type) : null;
  useEffect(markTracingViewLoadStartEffect, []);
  return (
    <TracingLayoutView
      initialMaybeCompoundType={initialMaybeCompoundType}
      initialCommandType={{
        type: ControlModeEnum.TRACE,
        annotationId: id || "",
      }}
    />
  );
}

export function TracingSandboxLegacyRouteWrapper() {
  const { type, datasetName = "", organizationId = "" } = useParams();
  const location = useLocation();

  const tracingType = coalesce(TracingTypeEnum, type);
  if (tracingType == null) {
    return <Typography.Title level={3}>Invalid annotation URL.</Typography.Title>;
  }
  const getParams = getUrlParamsObjectFromString(location.search);
  return (
    <AsyncRedirect
      redirectTo={async () => {
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

export function TracingSandboxRouteWrapper() {
  const { type, datasetNameAndId = "" } = useParams();
  const location = useLocation();

  const tracingType = coalesce(TracingTypeEnum, type);
  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = getUrlParamsObjectFromString(location.search);

  if (tracingType == null) {
    return <Typography.Title level={3}>Invalid annotation URL.</Typography.Title>;
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
}

export function TracingViewModeLegacyWrapper() {
  const { datasetName = "", organizationId = "" } = useParams();
  const location = useLocation();
  const getParams = getUrlParamsObjectFromString(location.search);

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
}

export function TracingViewModeRouteWrapper() {
  const { datasetNameAndId = "" } = useParams();
  const location = useLocation();

  const { datasetId, datasetName } = getDatasetIdOrNameFromReadableURLPart(datasetNameAndId);
  const getParams = getUrlParamsObjectFromString(location.search);
  useEffect(markTracingViewLoadStartEffect, []);
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
}

export function OnboardingRouteWrapper() {
  return !features()?.isWkorgInstance ? <Onboarding /> : <PageNotFoundView />;
}
