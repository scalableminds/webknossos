import { Button, Radio, RadioChangeEvent, Space } from "antd";
import React from "react";
import { WizardComponentProps } from "./common";

export default function SelectImportType({
  wizardContext,
  setWizardContext,
}: WizardComponentProps) {
  const { composeMode } = wizardContext;

  const onNext = () => {
    setWizardContext((oldContext) => ({
      ...oldContext,
      currentWizardStep: composeMode === "WITHOUT_TRANSFORMS" ? "SelectDatasets" : "UploadFiles",
    }));
  };
  const onChange = (e: RadioChangeEvent) => {
    setWizardContext((oldContext) => ({
      ...oldContext,
      composeMode: e.target.value,
    }));
  };

  return (
    <div>
      <div>
        <p>Select how you want to create a new dataset:</p>
        <Radio.Group onChange={onChange} value={composeMode}>
          <Space direction="vertical">
            <Radio value={"WITHOUT_TRANSFORMS"}>Combine datasets without any transforms</Radio>
            <Radio value={"WK_ANNOTATIONS"}>Combine datasets by using skeleton annotations</Radio>
            <Radio value={"BIG_WARP"}>Combine datasets by using a BigWarp CSV</Radio>
          </Space>
        </Radio.Group>
      </div>
      <Button type="primary" style={{ marginTop: 16 }} onClick={onNext}>
        Next
      </Button>
    </div>
  );
}
