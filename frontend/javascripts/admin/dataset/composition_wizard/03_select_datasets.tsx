import { Button } from "antd";
import { AsyncButton } from "components/async_clickables";
import DatasetSelectionComponent, {
  type DatasetSelectionValue,
} from "dashboard/dataset/dataset_selection_component";
import { useState } from "react";
import { tryToFetchDatasetsByNameOrId, type WizardComponentProps } from "./common";
import { useEffectOnlyOnce } from "libs/react_hooks";

export default function SelectDatasets({ wizardContext, setWizardContext }: WizardComponentProps) {
  const [datasetValues, setDatasetValues] = useState<DatasetSelectionValue[]>([]);

  const onPrev = () => {
    setWizardContext((oldContext) => ({
      ...oldContext,
      currentWizardStep:
        wizardContext.composeMode === "WITHOUT_TRANSFORMS" ? "SelectImportType" : "UploadFiles",
    }));
  };
  const onNext = async () => {
    const datasets = await tryToFetchDatasetsByNameOrId(
      [],
      datasetValues.map((el) => el.value), // fetch by id
      "Could not find datasets. Please doublecheck your selection.",
    );
    if (datasets == null) {
      // An error message was already shown in tryToFetchDatasetsByNameOrId
      return;
    }

    setWizardContext((oldContext) => ({
      ...oldContext,
      currentWizardStep: "ConfigureNewDataset",
      datasets,
    }));
  };

  useEffectOnlyOnce(() => {
    setDatasetValues(wizardContext.datasets.map((ds) => ({ value: ds.id, label: ds.name })));
  });

  // When not using any transforms,
  let isDatasetCountValid = true;
  if (wizardContext.composeMode === "WITHOUT_TRANSFORMS") {
    isDatasetCountValid = datasetValues.length > 0;
  } else {
    isDatasetCountValid = datasetValues.length === 2;
  }

  return (
    <div>
      <p>
        Select the datasets that you want to combine or doublecheck the pre-selected datasets. Note
        that the order of the datasets is important and needs to be equal to the order of the files
        from the upload.
      </p>
      <DatasetSelectionComponent
        datasetValues={datasetValues}
        setDatasetValues={setDatasetValues}
      />

      <Button style={{ marginTop: 16 }} onClick={onPrev}>
        Back
      </Button>

      <AsyncButton
        disabled={!isDatasetCountValid}
        type="primary"
        style={{ marginTop: 16, marginLeft: 8 }}
        onClick={onNext}
      >
        Next
      </AsyncButton>
    </div>
  );
}
