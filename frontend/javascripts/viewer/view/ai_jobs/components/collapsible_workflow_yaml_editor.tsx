import { Checkbox, Collapse, Form, Input } from "antd";
import { useCallback } from "react";

const { TextArea } = Input;
const FormItem = Form.Item;

export function CollapsibleWorkflowYamlEditor({
  isActive = false,
  setActive,
}: {
  isActive: boolean;
  setActive: (active: boolean) => void;
}) {
  const handleCollapseChange = useCallback(() => setActive(!isActive), [isActive, setActive]);

  return (
    <Collapse
      style={{ marginBottom: 8 }}
      onChange={handleCollapseChange}
      expandIcon={() => <Checkbox checked={isActive} />}
      items={[
        {
          key: "advanced",
          label: "Advanced",
          children: (
            <FormItem name="workflowYaml" label="Workflow Description (yaml)">
              <TextArea
                autoSize={{
                  minRows: 6,
                }}
                styles={{
                  textarea: {
                    fontFamily:
                      'SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace',
                  },
                }}
              />
            </FormItem>
          ),
        },
      ]}
      activeKey={isActive ? "advanced" : []}
    />
  );
}
