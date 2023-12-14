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
      <p>
        You can create a new dataset by composing existing datasets together. There are three
        different ways to accomplish this:
        <ul>
          <li>Select existing datasets which should be combined without any transforms</li>
          <li>Create landmarks nodes using the skeleton tool and upload these annotations here.</li>
          <li>Import a landmark CSV as it can be exported by Big Warp.</li>
        </ul>
        In all three cases, you can later tweak which layers should be used.
      </p>
      <div>
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
