import { useQuery } from "@tanstack/react-query";
import {
  getDatasetIdFromNameAndOrganization,
  getOrganizationForDataset,
} from "admin/api/disambiguate_legacy_routes";
import { convertAnnotationToDataset, getBackingAnnotation } from "admin/api/unified_datasets";
import Onboarding from "admin/onboarding";
import { createExplorational, getShortLink } from "admin/rest_api";
import { Button, Result, Typography } from "antd";
import BrainSpinner from "components/brain_spinner";
import AsyncRedirect from "components/redirect";
import DashboardView, { urlTokenToTabKeyMap } from "dashboard/dashboard_view";
import { DatasetSettingsProvider } from "dashboard/dataset/dataset_settings_provider";
import DatasetSettingsView from "dashboard/dataset/dataset_settings_view";
import features from "features";
import loadable from "libs/lazy_loader";
import { useWkSelector } from "libs/react_hooks";
import { coalesce, getUrlParamsObjectFromString } from "libs/utils";
import window from "libs/window";
import isNumber from "lodash-es/isNumber";
import { useEffect } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router";
import { APICompoundTypeEnum, type APIMagRestrictions, TracingTypeEnum } from "types/api_types";
import { ControlModeEnum, PerformanceMarkEnum } from "viewer/constants";
import { getDatasetIdOrNameFromReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import { Store } from "viewer/singletons";
import { PageNotFoundView } from "./page_not_found_view";

// The viewer is only loaded when it is opened (see viewer/viewer_entry.ts). While its code is
// loading, show the same spinner that the viewer shows while it loads the dataset, so that both
// phases appear as one.
const TracingLayoutView = loadable(() => import("viewer/viewer_entry"), {
  fallback: <BrainSpinner />,
});

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

  useEffect(() => {
    if (!activeUser) {
      // Hard navigate so that webknossos.org is shown for the wkorg instance.
      window.location.href = "/";
    }
  }, [activeUser]);

  if (activeUser) {
    return <DashboardView userId={null} isAdminView={false} initialTabKey={null} />;
  }
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
  return (
    <DatasetSettingsProvider isEditingMode datasetId={datasetId || ""}>
      <DatasetSettingsView />
    </DatasetSettingsProvider>
  );
}

export function CreateAnnotationRouteWrapper() {
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
  const annotationView = (
    <TracingLayoutView
      initialMaybeCompoundType={initialMaybeCompoundType}
      initialCommandType={{
        type: ControlModeEnum.TRACE,
        annotationId: id || "",
      }}
    />
  );
  if (features().unifiedDatasets && initialMaybeCompoundType == null && id != null) {
    return <ConvertedAnnotationRedirect annotationId={id} fallback={annotationView} />;
  }
  return annotationView;
}

// Unified datasets prototype: explorational annotations are converted to datasets when opened, so
// that old links keep working. Task annotations (and anything that fails) open as today.
function ConvertedAnnotationRedirect({
  annotationId,
  fallback,
}: {
  annotationId: string;
  fallback: React.ReactElement;
}) {
  const location = useLocation();
  const { data, isError } = useQuery({
    queryKey: ["convertAnnotationToDataset", annotationId],
    queryFn: () => convertAnnotationToDataset(annotationId),
    meta: { persist: false },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isError || (data != null && data.datasetId == null)) {
    return fallback;
  }
  if (data == null) {
    return <BrainSpinner />;
  }
  return (
    <Navigate
      replace
      to={`/datasets/${data.datasetName}-${data.datasetId}/view${location.search}${location.hash}`}
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
  if (features().unifiedDatasets) {
    return (
      <UnifiedDatasetViewRouteWrapper datasetId={datasetId || ""} sharingToken={getParams.token} />
    );
  }
  return <DatasetViewModeLayoutView datasetId={datasetId || ""} />;
}

function DatasetViewModeLayoutView({ datasetId }: { datasetId: string }) {
  return (
    <TracingLayoutView
      initialMaybeCompoundType={null}
      initialCommandType={{
        type: ControlModeEnum.VIEW,
        datasetId,
      }}
    />
  );
}

// Unified datasets prototype: a dataset's annotation layers live in its backing annotation, which is
// opened under the dataset's URL. Without one, the dataset opens in plain view mode.
function UnifiedDatasetViewRouteWrapper({
  datasetId,
  sharingToken,
}: {
  datasetId: string;
  sharingToken: string | undefined;
}) {
  const { data: backingAnnotation, isError } = useQuery({
    queryKey: ["backingAnnotation", datasetId, sharingToken],
    queryFn: () => getBackingAnnotation(datasetId, sharingToken),
    // The answer depends on permissions and may create the annotation, so never reuse a stale one.
    meta: { persist: false },
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (isError) {
    // The viewer reports why the dataset cannot be opened.
    return <DatasetViewModeLayoutView datasetId={datasetId} />;
  }
  if (backingAnnotation == null) {
    return <BrainSpinner />;
  }
  if (backingAnnotation.annotationId == null) {
    return <DatasetViewModeLayoutView datasetId={datasetId} />;
  }
  if (backingAnnotation.access === "none") {
    return <PrivateDatasetView />;
  }
  return (
    <TracingLayoutView
      initialMaybeCompoundType={null}
      initialCommandType={{
        type: ControlModeEnum.TRACE,
        annotationId: backingAnnotation.annotationId,
      }}
    />
  );
}

function PrivateDatasetView() {
  return (
    <Result
      status="403"
      title="This dataset is private"
      subTitle="Its owner has restricted it to themselves. Ask them to share it with you."
      extra={
        <Link to="/dashboard">
          <Button type="primary">Back to the dashboard</Button>
        </Link>
      }
    />
  );
}

export function OnboardingRouteWrapper() {
  return !features()?.isWkorgInstance ? <Onboarding /> : <PageNotFoundView />;
}
