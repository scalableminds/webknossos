import { Button, Modal, Input } from "antd";
import React, { useState } from "react";

function HelpModal() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [helpText, setHelpText] = useState("");

  const sendHelp = () => {
    setModalOpen(false);

    if (helpText.length > 0) {
      // API Call or Email
    }
  };

  return (
    <>
      <Button
        type="primary"
        onClick={() => setModalOpen(true)}
        style={{ position: "fixed", right: 0, bottom: "20%", transform: "rotate(270deg)" }}
      >
        Help
      </Button>
      <Modal
        title="Do you have any questions?"
        style={{ right: 10, bottom: 40, top: "auto", position: "fixed" }}
        visible={isModalOpen}
        onOk={sendHelp}
        onCancel={() => setModalOpen(false)}
        mask={false}
        okText="Send"
        width={300}
      >
        <p>We are happy to help as soon as possibile and will get back to you.</p>
        <Input.TextArea
          rows={6}
          value={helpText}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setHelpText(e.target.value)}
        ></Input.TextArea>
      </Modal>
    </>
  );
}

export default HelpModal;
