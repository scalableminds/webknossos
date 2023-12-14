import { CardContainer } from "admin/dataset/dataset_components";
import React, { useState } from "react";
import { APIDataStore } from "types/api_flow_types";
import SelectImportType from "./composition_wizard/01_select_import_type";
import UploadFiles from "./composition_wizard/02_upload_files";
import SelectDatasets from "./composition_wizard/03_select_datasets";
import { ConfigureNewDataset } from "./composition_wizard/04_configure_new_dataset";
import { WizardComponentProps, WizardContext } from "./composition_wizard/common";

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
      <CardContainer title="Compose a dataset from existing dataset layers">
        <p>
          You can create a new dataset by composing existing datasets together. To align multiple
          datasets with each other, create landmarks nodes using the skeleton tool. Then, download
          these annotations as NMLs and drop them in the following landmarks input. Alternatively,
          you can also add a landmark CSV as it can be exported by Big Warp. WEBKNOSSOS will try to
          find the datasets that are referenced in these files and will create transformations using
          these landmarks.
        </p>
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
