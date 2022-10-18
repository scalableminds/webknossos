import { sendHelpEmail, updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import { Modal, Input, Alert } from "antd";
import { enforceActiveUser } from "oxalis/model/accessors/user_accessor";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { OxalisState } from "oxalis/store";
import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";

function HelpModal() {
  const [isModalOpen, setModalOpen] = useState(false);
  const [helpText, setHelpText] = useState("");

  const dispatch = useDispatch();
  const activeUser = useSelector((state: OxalisState) => enforceActiveUser(state.activeUser));

  const sendHelp = () => {
    setModalOpen(false);

    if (helpText.length > 0) {
      sendHelpEmail(helpText);
    }
  };

  const discardButton = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    // prevent the modal from also being shown
    e.stopPropagation();

    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      hasDiscardedHelpButton: true,
    });
    dispatch(setActiveUserAction(newUserSync));
  };

  if (!activeUser) return null;

  if (activeUser && activeUser.novelUserExperienceInfos.hasDiscardedHelpButton) return null;

  return (
    <>
      <Alert
        style={{
          position: "fixed",
          right: 0,
          bottom: "20%",
          transform: "rotate(-90deg)",
          transformOrigin: "bottom right",
          zIndex: 100,
          cursor: "pointer",
          height: 22,
          padding: 8,
        }}
        type="info"
        message="Help"
        closable
        onClose={discardButton}
        onClick={() => setModalOpen(true)}
      >
        Help
      </Alert>
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
        />
      </Modal>
    </>
  );
}

export default HelpModal;
