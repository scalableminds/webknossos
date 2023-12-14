import { getDataset } from "admin/admin_rest_api";
import { UploadFile } from "antd";
import Toast from "libs/toast";
import { Vector3 } from "oxalis/constants";
import { Store } from "oxalis/singletons";
import { APIDataset, APIDataStore } from "types/api_flow_types";

type FileList = UploadFile<any>[];

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
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion?: boolean | null | undefined,
  ) => Promise<void>;
};

export async function tryToFetchDatasetsByName(
  name1: string,
  name2: string,
): Promise<APIDataset[] | null> {
  const { activeUser } = Store.getState();
  try {
    const [dataset1, dataset2] = await Promise.all([
      getDataset(
        {
          owningOrganization: activeUser?.organization || "",
          name: name1,
        },
        null,
        { showErrorToast: false },
      ),
      getDataset(
        {
          owningOrganization: activeUser?.organization || "",
          name: name2,
        },
        null,
        { showErrorToast: false },
      ),
    ]);
    return [dataset1, dataset2];
  } catch (exception) {
    console.warn(exception);
    Toast.warning("Could not derive datasets from NML. Please specify these manally.");
    return null;
  }
}
