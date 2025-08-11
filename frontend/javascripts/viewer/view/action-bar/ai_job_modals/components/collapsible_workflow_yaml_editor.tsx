import { Checkbox, Collapse, Form, Input } from "antd";

const { TextArea } = Input;
const FormItem = Form.Item;

export function CollapsibleWorkflowYamlEditor({
  isActive = false,
  setActive,
}: { isActive: boolean; setActive: (active: boolean) => void }) {
  return (
    <Collapse
      style={{ marginBottom: 8 }}
      onChange={() => setActive(!isActive)}
      expandIcon={() => <Checkbox checked={isActive} />}
      items={[
        {
          key: "advanced",
          label: "Advanced",
          children: (
            <FormItem name="workflowYaml" label="Workflow Description (yaml)">
              <TextArea
                className="input-monospace"
                autoSize={{
                  minRows: 6,
                }}
                style={{
                  fontFamily: 'Monaco, Consolas, "Lucida Console", "Courier New", monospace',
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
