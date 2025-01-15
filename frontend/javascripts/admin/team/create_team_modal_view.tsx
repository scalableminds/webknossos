import { TagOutlined } from "@ant-design/icons";
import { createTeam } from "admin/admin_rest_api";
import { Form, Input, Modal } from "antd";
import Shortcut from "libs/shortcut_component";
const FormItem = Form.Item;
type Props = {
  onOk: (...args: Array<any>) => any;
  onCancel: (...args: Array<any>) => any;
  isOpen: boolean;
};

function CreateTeamModalForm({ onOk: onOkCallback, onCancel, isOpen }: Props) {
  const [form] = Form.useForm();

  const onOk = async () => {
    form.validateFields().then(async (values) => {
      const newTeam = {
        name: values.teamName,
        roles: [
          {
            name: "admin",
          },
          {
            name: "user",
          },
        ],
      };
      const team = await createTeam(newTeam);
      onOkCallback(team);
    });
  };

  return (
    <Modal open={isOpen} title="Add a New Team" okText="Ok" onCancel={onCancel} onOk={onOk}>
      <Shortcut keys="enter" onTrigger={onOk} supportInputElements />

      <Form layout="vertical" form={form}>
        <FormItem
          name="teamName"
          label="Team Name"
          rules={[
            {
              required: true,
              // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'RegExp | ... Remove this comment to see the full error message
              pattern: "^[A-Za-z0-9\\-_\\. ß]+$",
              message: "The team name must not contain any special characters.",
            },
          ]}
        >
          <Input prefix={<TagOutlined />} placeholder="Team Name" autoFocus />
        </FormItem>
      </Form>
    </Modal>
  );
}

const CreateTeamModalView = CreateTeamModalForm;
export default CreateTeamModalView;
