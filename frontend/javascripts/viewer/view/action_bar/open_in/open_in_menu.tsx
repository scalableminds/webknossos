import { ExportOutlined } from "@ant-design/icons";
import { getSharingTokenFromUrlParameters } from "admin/api/token";
import {
  createPrivateLink,
  getBuildInfo,
  getDatasetSharingToken,
  getPrivateLinksByAnnotation,
} from "admin/rest_api";
import type { SubMenuType } from "antd/es/menu/interface";
import dayjs from "dayjs";
import Toast from "libs/toast";
import type { APIDataLayer } from "types/api_types";
import { ControlModeEnum, OrthoViews } from "viewer/constants";
import {
  getDefaultValueRangeOfLayer,
  getOrderedColorLayers,
  getSegmentationLayers,
} from "viewer/model/accessors/dataset_accessor";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import { getInputCatcherRect } from "viewer/model/accessors/view_mode_accessor";
import {
  buildFijiUrl,
  buildNeuroglancerState,
  buildNeuroglancerUrl,
  type NeuroglancerLayerInput,
} from "viewer/model/helpers/neuroglancer_state";
import { getZarrBaseUrl, getZarrLayerName } from "viewer/model/helpers/zarr_links";
import Store, { type WebknossosState } from "viewer/store";

const DEFAULT_VIEWPORT_HEIGHT = 1024;
// Existing private links that expire sooner than this are not reused.
const MIN_PRIVATE_LINK_VALIDITY_IN_DAYS = 1;

type ZarrUrlResolver = (layer: APIDataLayer) => string | null;

async function getOrCreatePrivateLinkToken(annotationId: string): Promise<string> {
  const links = await getPrivateLinksByAnnotation(annotationId);
  const minExpiration = dayjs().add(MIN_PRIVATE_LINK_VALIDITY_IN_DAYS, "day").valueOf();
  const validLink = links.find(
    (link) => link.expirationDateTime == null || link.expirationDateTime > minExpiration,
  );
  if (validLink != null) {
    return validLink.accessToken;
  }
  const newLink = await createPrivateLink(annotationId);
  Toast.info(
    "Created a Zarr private link for this annotation. It can be managed via Menu > Zarr Links.",
  );
  return newLink.accessToken;
}

async function getDatasetTokenQuery(state: WebknossosState): Promise<string> {
  const { dataset, activeUser } = state;
  if (dataset.isPublic) {
    return "";
  }
  const urlToken = getSharingTokenFromUrlParameters();
  if (urlToken != null) {
    return `?token=${urlToken}`;
  }
  if (activeUser == null) {
    return "";
  }
  const sharingToken = await getDatasetSharingToken(dataset.id, { doNotInvestigate: true });
  return `?token=${sharingToken}`;
}

async function getZarrUrlResolver(state: WebknossosState): Promise<ZarrUrlResolver> {
  const { dataset, annotation } = state;
  const { currentApiVersion } = (await getBuildInfo()).httpApiVersioning;
  const dataStoreUrl = dataset.dataStore.url;

  const isPersistedAnnotation = state.temporaryConfiguration.controlMode === ControlModeEnum.TRACE;
  if (isPersistedAnnotation && annotation.restrictions.allowUpdate) {
    const accessToken = await getOrCreatePrivateLinkToken(annotation.annotationId);
    const baseUrl = getZarrBaseUrl(dataStoreUrl, currentApiVersion, dataset.id, accessToken);
    return (layer) => `${baseUrl}/${getZarrLayerName(layer, annotation)}`;
  }

  // Without a private link, only the dataset layers can be streamed. Volume annotation layers
  // are replaced by their fallback layer, if they have one.
  const baseUrl = getZarrBaseUrl(dataStoreUrl, currentApiVersion, dataset.id, null);
  const tokenQuery = await getDatasetTokenQuery(state);
  const hasVolumeLayers = annotation.volumes.length > 0;
  if (hasVolumeLayers) {
    Toast.warning(
      "Volume annotation layers can only be opened externally from saved annotations that you are allowed to edit. Their fallback dataset layers are used instead, if available.",
    );
  }
  return (layer) => {
    if ("tracingId" in layer && layer.tracingId != null) {
      return layer.fallbackLayer != null ? `${baseUrl}/${layer.fallbackLayer}${tokenQuery}` : null;
    }
    return `${baseUrl}/${layer.name}${tokenQuery}`;
  };
}

function getLayerInputs(
  state: WebknossosState,
  layers: Array<APIDataLayer>,
  resolveUrl: ZarrUrlResolver,
): Array<NeuroglancerLayerInput> {
  const { dataset, annotation, datasetConfiguration } = state;
  return layers.flatMap((layer) => {
    const url = resolveUrl(layer);
    if (url == null) {
      return [];
    }
    return [
      {
        name: getZarrLayerName(layer, annotation),
        url,
        elementClass: layer.elementClass,
        defaultValueRange: getDefaultValueRangeOfLayer(dataset, layer.name),
        config: datasetConfiguration.layers[layer.name],
      },
    ];
  });
}

function getFirstColorLayer(state: WebknossosState): APIDataLayer | undefined {
  return getOrderedColorLayers(state.dataset, state.datasetConfiguration.colorLayerOrder)[0];
}

async function openInNeuroglancer() {
  // Open the window synchronously so that popup blockers don't interfere
  // with the asynchronous URL resolution.
  const neuroglancerWindow = window.open("", "_blank");
  try {
    const state = Store.getState();
    const resolveUrl = await getZarrUrlResolver(state);
    const ngState = buildNeuroglancerState({
      voxelSize: state.dataset.dataSource.scale,
      position: getPosition(state.flycam),
      zoomStep: state.flycam.zoomStep,
      viewportHeight:
        getInputCatcherRect(state, OrthoViews.PLANE_XY).height || DEFAULT_VIEWPORT_HEIGHT,
      colorLayers: getLayerInputs(
        state,
        getOrderedColorLayers(state.dataset, state.datasetConfiguration.colorLayerOrder),
        resolveUrl,
      ),
      segmentationLayers: getLayerInputs(state, getSegmentationLayers(state.dataset), resolveUrl),
    });
    const url = buildNeuroglancerUrl(ngState);
    if (neuroglancerWindow != null) {
      neuroglancerWindow.opener = null;
      neuroglancerWindow.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
    }
  } catch (error) {
    neuroglancerWindow?.close();
    console.error(error);
    Toast.error("Could not open the dataset in Neuroglancer.");
  }
}

async function openInFiji() {
  try {
    const state = Store.getState();
    const colorLayer = getFirstColorLayer(state);
    if (colorLayer == null) {
      Toast.warning("This dataset has no color layer that could be opened in Fiji.");
      return;
    }
    const resolveUrl = await getZarrUrlResolver(state);
    const zarrUrl = resolveUrl(colorLayer);
    if (zarrUrl == null) {
      return;
    }
    window.location.href = buildFijiUrl(zarrUrl);
    Toast.info(
      "Opening the first color layer in Fiji. This requires Fiji with the OME-Zarr update site and enabled web links (Edit > Options > Desktop).",
    );
  } catch (error) {
    console.error(error);
    Toast.error("Could not open the dataset in Fiji.");
  }
}

export const openInMenu: SubMenuType = {
  key: "open-in-menu",
  icon: <ExportOutlined />,
  label: "Open in",
  children: [
    {
      key: "open-in-neuroglancer",
      label: "Neuroglancer",
      onClick: openInNeuroglancer,
    },
    {
      key: "open-in-fiji",
      label: "Fiji",
      onClick: openInFiji,
    },
  ],
};
