import { CopyOutlined, SwapOutlined } from "@ant-design/icons";
import {
  getAuthToken,
  revokeAuthToken,
  doWebAuthnRegistration,
  listWebAuthnKeys,
  removeWebAuthnKey,
} from "admin/admin_rest_api";
import { Button, Col, Form, Input, Modal, Row, Space, Spin } from "antd";
import Toast from "libs/toast";
import type { OxalisState } from "oxalis/store";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

import { } from "@github/webauthn-json/browser-ponyfill";

const FormItem = Form.Item;

function ManagePassKeyView() {
  const [isPassKeyNameModalOpen, setIsPassKeyNameModalOpen] = useState(false);
  const [newPassKeyName, setNewPassKeyName] = useState("");
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [passkeys, setPasskeys] = useState([]);
  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData(): Promise<void> {
     setIsLoading(true);
     const keys = await listWebAuthnKeys();
     setPasskeys(keys);
     setIsLoading(false);
  }

  const registerNewPassKey = async () => {
    try {
      setIsPassKeyNameModalOpen(false);
      const result = doWebAuthnRegistration(newPassKeyName);
      console.debug(result);
      Toast.success("PassKey registered successfully");
      setNewPassKeyName("");
      await fetchData();
    } catch (e) {
      Toast.error(`Registering new PassKey '${newPassKeyName}' failed`);
      console.error("Could not register new PassKey", e);
    }
  };

  return (
    <div>
      <Row
        justify="center"
        style={{
          padding: 50,
        }}
        align="middle"
      >
        <Col span={8}>
          <h3>Your PassKeys</h3>
          {passkeys.map(passkey =>
            <Row key={passkey.id}>
              {passkey.name}
              <Button onClick={async () => {
                await removeWebAuthnKey(passkey)
                await fetchData();
              }}>Delete</Button>
            </Row>
          )}
        </Col>
      </Row>
      <Row justify="center" align="middle">
        <Col span={8}>
          <p>
            PassKeys are a new web authentication method that allows you to log in without a
            password in a secured way. Microsoft Hello and Apple FaceID are examples of technologies
            that can be used as passkeys to log in in WEBKNOSSOS. If you want to add a new passkey
            to your account use the button below.
          </p>
          <Button onClick={() => setIsPassKeyNameModalOpen(true)} type="primary">
            Register new PassKey
          </Button>
        </Col>
      </Row>
      <Modal
        title="Enter a name for the new PassKey"
        open={isPassKeyNameModalOpen}
        onOk={registerNewPassKey}
        onCancel={() => setIsPassKeyNameModalOpen(false)}
      >
        <Input
          placeholder="PassKey name"
          value={newPassKeyName}
          onChange={(e) => setNewPassKeyName(e.target.value)}
        />
      </Modal>
    </div>
  );
}

export default ManagePassKeyView;
