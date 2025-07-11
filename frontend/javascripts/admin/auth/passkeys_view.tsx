import { DeleteOutlined } from "@ant-design/icons";
import {
  type WebAuthnKeyDescriptor,
  doWebAuthnRegistration,
  listWebAuthnKeys,
  removeWebAuthnKey,
} from "admin/api/webauthn";
import { Button, Input, Modal, Table } from "antd";
import Toast from "libs/toast";
import { useEffect, useState } from "react";
import { type RouteComponentProps, withRouter } from "react-router-dom";

function ChangePasswordView() {
  /// Passkeys
  const [isPasskeyNameModalOpen, setIsPasskeyNameModalOpen] = useState(false);
  const [newPasskeyName, setNewPasskeyName] = useState("");

  const [passkeys, setPasskeys] = useState<WebAuthnKeyDescriptor[]>([]);
  async function fetchPasskeys(): Promise<void> {
    const passkeys = await listWebAuthnKeys();
    setPasskeys(passkeys);
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once
  useEffect(() => {
    fetchPasskeys();
  }, []);

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
      render: (_id: string, passkey: WebAuthnKeyDescriptor) => (
        <Button
          type="default"
          shape="circle"
          icon={<DeleteOutlined />}
          onClick={webauthnRemoveKey(passkey)}
          size="small"
        />
      ),
    },
  ];

  return (
    <>
      <Table
        dataSource={passkeys}
        columns={passkeyColumns}
        rowKey="id"
        pagination={{
          hideOnSinglePage: true,
        }}
        showHeader={false}
      />

      <div style={{ paddingTop: 10 }}>
        <Button onClick={() => setIsPasskeyNameModalOpen(true)} type="primary">
          Register Passkey
        </Button>
      </div>
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
  );
}

export default withRouter<RouteComponentProps, any>(ChangePasswordView);
