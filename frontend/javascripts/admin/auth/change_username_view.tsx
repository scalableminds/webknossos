import { UserOutlined } from "@ant-design/icons";
import { updateUser } from "admin/rest_api";
import { Button, Form, Input, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import type { APIUser } from "types/api_types";

const FormItem = Form.Item;

const FIRST_NAME_FIELD_KEY = "firstName";
const LAST_NAME_FIELD_KEY = "lastName";

function ChangeUsernameView({
  onClose,
  setEditedUser,
  user,
}: {
  onClose: () => void;
  setEditedUser: (updatedUser: APIUser) => void;
  user: APIUser;
}) {
  const [form] = Form.useForm();
  const activeUser = useWkSelector((state) => state.activeUser);

  async function changeName(newFirstName: string, newLastName: string) {
    const newUser = {
      ...user,
      firstName: newFirstName,
      lastName: newLastName,
    };
    return updateUser(newUser);
  }

  async function onFinish() {
    const hasNameBeenChanged =
      form.isFieldTouched(FIRST_NAME_FIELD_KEY) || form.isFieldTouched(LAST_NAME_FIELD_KEY);
    if (hasNameBeenChanged) {
      try {
        const firstName = form.getFieldValue(FIRST_NAME_FIELD_KEY) || user.firstName;
        const lastName = form.getFieldValue(LAST_NAME_FIELD_KEY) || user.lastName;
        const updatedUser = await changeName(firstName, lastName);
        if (activeUser?.id === user?.id) {
          Toast.success(`You successfully changed your name to ${firstName} ${lastName}.`);
        } else {
          Toast.success(`You successfully changed the name to ${firstName} ${lastName}.`);
        }
        setEditedUser(updatedUser);
      } catch (error) {
        const errorMsg = "An unexpected error occurred while changing the name.";
        Toast.error(errorMsg);
        console.error(errorMsg, error);
      }
    }
    onClose();
  }

  const validateNameNotEmpty = (_: any, value: string, fieldName: string) => {
    if (!form.isFieldTouched(fieldName)) return Promise.resolve();
    if (value != null && value?.trim().length === 0) {
      return Promise.reject(new Error("First and last name cannot be empty or whitespace only"));
    }
    return Promise.resolve();
  };

  const characterPattern = {
    pattern: /^[a-zA-ZÀ-ÿ'-]+$/,
    message: "Name can only contain letters, hyphens and apostrophes",
  };

  return (
    <Form onFinish={onFinish} form={form}>
      <FormItem
        hasFeedback
        name={FIRST_NAME_FIELD_KEY}
        rules={[
          { validator: (rule, value) => validateNameNotEmpty(rule, value, FIRST_NAME_FIELD_KEY) },
          characterPattern,
        ]}
      >
        <Input
          prefix={
            <UserOutlined
              style={{
                fontSize: 13,
              }}
            />
          }
          defaultValue={user.firstName}
          placeholder="First Name"
        />
      </FormItem>
      <FormItem
        hasFeedback
        name={LAST_NAME_FIELD_KEY}
        rules={[
          { validator: (rule, value) => validateNameNotEmpty(rule, value, LAST_NAME_FIELD_KEY) },
          characterPattern,
        ]}
      >
        <Input
          prefix={
            <UserOutlined
              style={{
                fontSize: 13,
              }}
            />
          }
          defaultValue={user.lastName}
          placeholder="Last Name"
        />
      </FormItem>
      <FormItem>
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" htmlType="submit">
            Change Name
          </Button>
        </Space>
      </FormItem>
    </Form>
  );
}

export default ChangeUsernameView;
