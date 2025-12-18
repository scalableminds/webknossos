import { UserOutlined } from "@ant-design/icons";
import { updateUser } from "admin/rest_api";
import { Button, Form, Input, Space } from "antd";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { Store } from "viewer/singletons";

const FormItem = Form.Item;

const FIRST_NAME_FIELD_KEY = "firstName";
const LAST_NAME_FIELD_KEY = "lastName";

function ChangeNameView({ onClose }: { onClose: () => void }) {
    const [form] = Form.useForm();
    const activeUser = useWkSelector((state) => state.activeUser);

    async function changeName(newFirstName: string, newLastName: string) {
        const newUser = Object.assign({}, activeUser, {
            firstName: newFirstName,
            lastName: newLastName,
        });
        return updateUser(newUser);
    }

    async function onFinish() {
        const firstName = form.getFieldValue(FIRST_NAME_FIELD_KEY);
        const lastName = form.getFieldValue(LAST_NAME_FIELD_KEY);

        try {
            const updatedUser = await changeName(firstName, lastName);
            Store.dispatch(setActiveUserAction(updatedUser));
            onClose();
        } catch (error) {
            const errorMsg = "An unexpected error occurred while changing the name.";
            Toast.error(errorMsg);
            console.error(errorMsg, error);
        }
    }

    const validateNameNotEmpty = (_: any, value: string, fieldName: string) => {
        if (!form.isFieldTouched(fieldName)) return Promise.resolve();
        if (value != null && value?.trim().length === 0) {
            return Promise.reject(new Error("First name cannot be empty or whitespace only"));
        }
        return Promise.resolve();
    };

    return (
        <Form onFinish={onFinish} form={form}>
            <FormItem
                hasFeedback
                name={FIRST_NAME_FIELD_KEY}
                rules={[
                    { validator: (rule, value) => validateNameNotEmpty(rule, value, FIRST_NAME_FIELD_KEY) },
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
                    defaultValue={activeUser?.firstName}
                    placeholder="First Name"
                />
            </FormItem>
            <FormItem
                hasFeedback
                name={LAST_NAME_FIELD_KEY}
                rules={[
                    { validator: (rule, value) => validateNameNotEmpty(rule, value, LAST_NAME_FIELD_KEY) },
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
                    defaultValue={activeUser?.lastName}
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

export default ChangeNameView;
