import { CardContainer } from "admin/dataset/dataset_components";
import { useState } from "react";
import type { APIDataStore } from "types/api_flow_types";
import SelectImportType from "./composition_wizard/01_select_import_type";
import UploadFiles from "./composition_wizard/02_upload_files";
import SelectDatasets from "./composition_wizard/03_select_datasets";
import { ConfigureNewDataset } from "./composition_wizard/04_configure_new_dataset";
import type { WizardComponentProps, WizardContext } from "./composition_wizard/common";
import { dataPrivacyInfo } from "./dataset_upload_view";

type Props = {
  onAdded: WizardComponentProps["onAdded"];
  datastores: APIDataStore[];
};

const WIZARD_STEPS = {
  SelectImportType: {
    title: "Import type",
    component: SelectImportType,
  },
  UploadFiles: {
    title: "Upload file(s)",
    component: UploadFiles,
  },
  SelectDatasets: {
    title: "Select Datasets",
    component: SelectDatasets,
  },
  ConfigureNewDataset: {
    title: "Configure New Datasets",
    component: ConfigureNewDataset,
  },
} as const;

export default function DatasetAddComposeView(props: Props) {
  const [wizardContext, setWizardContext] = useState<WizardContext>({
    currentWizardStep: "SelectImportType",
    fileList: [],
    composeMode: "WITHOUT_TRANSFORMS",
    datasets: [],
    sourcePoints: [],
    targetPoints: [],
  });
  const { currentWizardStep } = wizardContext;
  const CurrentWizardComponent = WIZARD_STEPS[currentWizardStep].component;

  return (
    <div style={{ padding: 5 }}>
      <CardContainer
        title="Compose a dataset from existing dataset layers"
        subtitle={dataPrivacyInfo}
      >
        <CurrentWizardComponent
          wizardContext={wizardContext}
          setWizardContext={setWizardContext}
          datastores={props.datastores}
          onAdded={props.onAdded}
        />
      </CardContainer>
    </div>
  );
}
