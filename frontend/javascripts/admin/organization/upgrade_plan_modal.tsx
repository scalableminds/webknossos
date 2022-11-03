import React from "react";
import { Modal } from "antd";
import { RocketOutlined } from "@ant-design/icons";

function handleOkButton() {
  // TODO
  console.log("Request upgrade");
}

function open() {
  Modal.info({
    title: "Upgrade to Team Plan",
    okText: "Request Upgrade",
    onOk: handleOkButton,
    icon: <RocketOutlined />,
    width: 1000,
    content: (
      <div>
        Lorem ipsum dolor sit amet consectetur, adipisicing elit. Quasi, similique suscipit.
        Doloribus magnam cum quae quia ullam ipsum eius fuga natus, ad temporibus necessitatibus,
        commodi aspernatur veritatis praesentium, unde reiciendis.
      </div>
    ),
  });
}

export default { open: open };
