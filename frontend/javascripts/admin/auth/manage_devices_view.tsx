import { Row, Col, List, Button } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useSelector } from "react-redux";
import { requestWebAuthnRegistrationStart, requestWebAuthnRegistrationFinish, listWebAuthnDevices } from "admin/admin_rest_api";
import CBOR from "cbor-js";
import * as webauthnJson from "@github/webauthn-json";
import { useState } from "react";
import { useEffectOnlyOnce } from "libs/react_hooks";

function ManageDevicesView() {
  const user = useSelector((state: OxalisState) => state.activeUser);
  const [devices, setDevices] = useState([])

  async function fetchDevices() {
    const deviceList = await listWebAuthnDevices();
    setDevices(deviceList)
  }

  async function createNewCredential(user: APIUser) {
    const opts = await requestWebAuthnRegistrationStart()
    console.log(opts) // TODO: Remove
    const cred = await webauthnJson.create(opts)
    console.log(cred) // TODO: Remove
    console.log(await requestWebAuthnRegistrationFinish(cred))
    await fetchDevices()
  }

  useEffectOnlyOnce(() => {
    fetchDevices()
  })

  return (
    <div>
      <Row justify="center" style={{padding: 50}} align="middle">
        <Col span={8}>
          <List header={
            <div>
              Device
              <div className="pull-right" style={{ display: "flex" }}>
                <Button type="primary" onClick={ () => createNewCredential(user) } icon={<PlusOutlined />}>
                  Add
                </Button>
              </div>
            </div>
          }
            dataSource={devices}
            renderItem={(item) => (
              <List.Item>
                {item.id}
              </List.Item>
            )}>
          </List>
        </Col>
      </Row>
    </div>
  )
}

export default ManageDevicesView;
