import { LockOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Form, Input, Modal, Row, Table } from "antd";
import features from "features";
import Request from "libs/request";
import Toast from "libs/toast";
import messages from "messages";
import { type RouteComponentProps, withRouter } from "react-router-dom";
import { logoutUserAction } from "viewer/model/actions/user_actions";
import Store from "viewer/store";
const FormItem = Form.Item;
const { Password } = Input;
import {
  type WebAuthnKeyDescriptor,
  doWebAuthnRegistration,
  listWebAuthnKeys,
  removeWebAuthnKey,
} from "admin/webauthn";
import { useEffect, useState } from "react";

type Props = {
  history: RouteComponentProps["history"];
};

const MIN_PASSWORD_LENGTH = 8;

function ChangePasswordView({ history }: Props) {
  // Password Form
  const [form] = Form.useForm();

  const { passkeysEnabled } = features();
  const [isMounted, setIsMounted] = useState(false);

  /// Passkeys
  const [isPasskeyNameModalOpen, setIsPasskeyNameModalOpen] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");

  const [passkeys, setPasskeys] = useState<WebAuthnKeyDescriptor[]>([]);
  async function fetchPasskeys(): Promise<void> {
    const passkeys = await listWebAuthnKeys();
    setPasskeys(passkeys);
  }
  useEffect(() => {
    if (!isMounted) {
      setIsMounted(true);
      if (passkeysEnabled) {
        fetchPasskeys();
      }
    }
  });

  function onFinish(formValues: Record<string, any>) {
    Request.sendJSONReceiveJSON("/api/auth/changePassword", {
      data: formValues,
    }).then(async () => {
      Toast.success(messages["auth.reset_pw_confirmation"]);
      await Request.receiveJSON("/api/auth/logout");
      history.push("/auth/login");
      Store.dispatch(logoutUserAction());
    });
  }

  function checkPasswordsAreMatching(value: string, otherPasswordFieldKey: string[]) {
    const otherFieldValue = form.getFieldValue(otherPasswordFieldKey);

    if (value && otherFieldValue) {
      if (value !== otherFieldValue) {
        return Promise.reject(new Error(messages["auth.registration_password_mismatch"]));
      } else if (form.getFieldError(otherPasswordFieldKey).length > 0) {
        // If the other password field still has errors, revalidate it.
        form.validateFields([otherPasswordFieldKey]);
      }
    }

    return Promise.resolve();
  }

  function webauthnRemoveKey(passkey: WebAuthnKeyDescriptor): () => Promise<void> {
    return async function () {
      await removeWebAuthnKey(passkey.id);
      Toast.success("Passkey '" + passkey.name + "' is removed");
      await fetchPasskeys();
    };
  }

  const registerNewPasskey = async () => {
    const passkeyName = newPasskeyName.trim();
    if (passkeyName.length < 3) {
      Toast.error("Passkey name must be at least 3 characters");
      return;
    } else if (passkeys.some((pk) => pk.name.toLowerCase() === passkeyName.toLowerCase())) {
      Toast.error("A passkey with this name already exists");
      return;
    }
    setIsPasskeyNameModalOpen(false);
    await doWebAuthnRegistration(passkeyName);
    Toast.success("Passkey registered successfully");
    setNewPasskeyName("");
    fetchPasskeys();
  };

  const passkeyColumns = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      width: "100%",
    },
    {
      title: "Actions",
      dataIndex: "id",
      key: "id",
      render: (id: string, passkey: WebAuthnKeyDescriptor) => (
        <Button key={id} onClick={webauthnRemoveKey(passkey)}>
          Delete
        </Button>
      ),
    },
  ];

  return (
    <>
      <Row
        justify="center"
        align="middle"
        style={{
          padding: 50,
        }}
      >
        <Col span={8}>
          <h3>Change Password</h3>
          <Alert
            type="info"
            message={messages["auth.reset_logout"]}
            showIcon
            style={{
              marginBottom: 24,
            }}
          />
          <Form onFinish={onFinish} form={form}>
            <FormItem
              name="oldPassword"
              rules={[
                {
                  required: true,
                  message: messages["auth.reset_old_password"],
                },
              ]}
            >
              <Password
                prefix={
                  <LockOutlined
                    style={{
                      fontSize: 13,
                    }}
                  />
                }
                placeholder="Old Password"
              />
            </FormItem>
            <FormItem
              hasFeedback
              name={["password", "password1"]}
              rules={[
                {
                  required: true,
                  message: messages["auth.reset_new_password"],
                },
                {
                  min: MIN_PASSWORD_LENGTH,
                  message: messages["auth.registration_password_length"],
                },
                {
                  validator: (_, value: string) =>
                    checkPasswordsAreMatching(value, ["password", "password2"]),
                },
              ]}
            >
              <Password
                prefix={
                  <LockOutlined
                    style={{
                      fontSize: 13,
                    }}
                  />
                }
                placeholder="New Password"
              />
            </FormItem>
            <FormItem
              hasFeedback
              name={["password", "password2"]}
              rules={[
                {
                  required: true,
                  message: messages["auth.reset_new_password2"],
                },
                {
                  min: MIN_PASSWORD_LENGTH,
                  message: messages["auth.registration_password_length"],
                },
                {
                  validator: (_, value: string) =>
                    checkPasswordsAreMatching(value, ["password", "password1"]),
                },
              ]}
            >
              <Password
                prefix={
                  <LockOutlined
                    style={{
                      fontSize: 13,
                    }}
                  />
                }
                placeholder="Confirm New Password"
              />
            </FormItem>
            <FormItem>
              <Button
                type="primary"
                htmlType="submit"
                style={{
                  width: "100%",
                }}
              >
                Change Password
              </Button>
            </FormItem>
          </Form>
        </Col>
      </Row>
      {passkeysEnabled && (
        <>
          <Row
            justify="center"
            style={{
              padding: 50,
            }}
            align="middle"
          >
            <Col span={8}>
              <h3>Your Passkeys</h3>
              <p>
                Passkeys are a new web authentication method that allows you to log in without a
                password in a secured way. Microsoft Hello and Apple FaceID are examples of
                technologies that can be used as passkeys to log in to WEBKNOSSOS. If you want to
                add a new passkey to your account use the button below.
              </p>

              <Table
                dataSource={passkeys}
                columns={passkeyColumns}
                rowKey="id"
                showHeader={false}
              />

              <div style={{ paddingTop: 10 }}>
                <Button onClick={() => setIsPasskeyNameModalOpen(true)} type="primary">
                  Register Passkey
                </Button>
              </div>
            </Col>
          </Row>
          <Modal
            title="Enter a name for the new Passkey"
            open={isPasskeyNameModalOpen}
            onOk={registerNewPasskey}
            onCancel={() => setIsPasskeyNameModalOpen(false)}
          >
            <Input
              placeholder="Passkey name"
              value={newPasskeyName}
              onChange={(e) => setNewPasskeyName(e.target.value)}
            />
          </Modal>
        </>
      )}
    </>
  );
}

export default withRouter<RouteComponentProps, any>(ChangePasswordView);
