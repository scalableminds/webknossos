import { getDataset, getDatasetLegacy } from "admin/admin_rest_api";
import type { UploadFile } from "antd";
import Toast from "libs/toast";
import type { Vector3 } from "oxalis/constants";
import { Store } from "oxalis/singletons";
import type { APIDataStore, APIDataset } from "types/api_flow_types";

export type FileList = UploadFile<any>[];

export type WizardStep =
  | "SelectImportType"
  | "UploadFiles"
  | "SelectDatasets"
  | "ConfigureNewDataset";

export type COMPOSE_MODE = "WITHOUT_TRANSFORMS" | "WK_ANNOTATIONS" | "BIG_WARP";
export type WizardContext = {
  currentWizardStep: WizardStep;
  fileList: FileList;
  composeMode: COMPOSE_MODE;
  datasets: APIDataset[];
  sourcePoints: Vector3[];
  targetPoints: Vector3[];
};

export type WizardComponentProps = {
  wizardContext: WizardContext;
  setWizardContext: React.Dispatch<React.SetStateAction<WizardContext>>;
  datastores: APIDataStore[];
  onAdded: (
    datasetId: string,
    datasetName: string,
    needsConversion?: boolean | null | undefined,
  ) => Promise<void>;
};

export async function tryToFetchDatasetsByNameOrId(
  names: string[],
  ids: string[],
  userErrorMessage: string,
): Promise<APIDataset[] | null> {
  const { activeUser } = Store.getState();
  try {
    const datasets = await Promise.all([
      ...names.map((name) =>
        getDatasetLegacy(activeUser?.organization || "", name, null, { showErrorToast: false }),
      ),
      ...ids.map((id) => getDataset(id, null, { showErrorToast: false })),
    ]);
    return datasets;
  } catch (exception) {
    Toast.warning(userErrorMessage);
    console.warn(exception);
    return null;
  }
}
