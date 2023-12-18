import { getDataset } from "admin/admin_rest_api";
import { UploadFile } from "antd";
import Toast from "libs/toast";
import { Vector3 } from "oxalis/constants";
import { Store } from "oxalis/singletons";
import { APIDataset, APIDataStore } from "types/api_flow_types";

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
    datasetOrganization: string,
    uploadedDatasetName: string,
    needsConversion?: boolean | null | undefined,
  ) => Promise<void>;
};

export async function tryToFetchDatasetsByName(
  names: string[],
  userErrorMessage: string,
): Promise<APIDataset[] | null> {
  const { activeUser } = Store.getState();
  try {
    const datasets = await Promise.all(
      names.map((name) =>
        getDataset(
          {
            owningOrganization: activeUser?.organization || "",
            name: name,
          },
          null,
          { showErrorToast: false },
        ),
      ),
    );
    return datasets;
  } catch (exception) {
    console.warn(exception);
    Toast.warning(userErrorMessage);
    return null;
  }
}
