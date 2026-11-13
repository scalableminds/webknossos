import { Button, Radio, type RadioChangeEvent, Space, Typography } from "antd";
import type React from "react";
import type { WizardComponentProps } from "./common";

function OptionHint({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <Typography.Text type="secondary">{children}</Typography.Text>
    </div>
  );
}

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
      <div style={{ marginBottom: 8 }}>
        You can create a new dataset by composing existing datasets together. There are three
        different ways to accomplish this:
        <div style={{ margin: 12 }}>
          <Radio.Group onChange={onChange} value={composeMode}>
            <Space orientation="vertical">
              <Radio value={"WITHOUT_TRANSFORMS"}>
                Combine datasets without any transforms
                <OptionHint>
                  For layers that already line up. Otherwise, you can{" "}
                  <a
                    href="https://docs.webknossos.org/webknossos/datasets/registering_layers.html"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    register the layers in WEBKNOSSOS
                  </a>{" "}
                  afterwards by placing matching landmarks side by side.
                </OptionHint>
              </Radio>
              <Radio value={"WK_ANNOTATIONS"}>
                Combine datasets by using skeleton annotations (NML)
                <OptionHint>
                  For landmarks that you placed in a skeleton annotation of each dataset.
                </OptionHint>
              </Radio>
              <Radio value={"BIG_WARP"}>
                Combine datasets by using BigWarp landmarks (CSV)
                <OptionHint>For landmarks that you placed in BigWarp (Fiji).</OptionHint>
              </Radio>
            </Space>
          </Radio.Group>
        </div>
        In all three cases, you can tweak which layers should be used later.
      </div>
      <Button type="primary" style={{ marginTop: 16 }} onClick={onNext}>
        Next
      </Button>
    </div>
  );
}
