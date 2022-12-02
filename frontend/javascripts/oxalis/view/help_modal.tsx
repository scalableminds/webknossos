import { sendHelpEmail, updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import { Modal, Input, Alert } from "antd";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { OxalisState } from "oxalis/store";
import React, { CSSProperties, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

function HelpButton() {
  const [isModalOpen, setModalOpen] = useState(false);

  const dispatch = useDispatch();
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  const discardButton = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    // prevent the modal from also being shown
    e.stopPropagation();

    if (!activeUser) return;

    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      hasDiscardedHelpButton: true,
    });
    dispatch(setActiveUserAction(newUserSync));
  };

  if (!activeUser) return null;
  if (activeUser.novelUserExperienceInfos.hasDiscardedHelpButton) return null;

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
      <HelpModal
        isModalOpen={isModalOpen}
        onCancel={() => setModalOpen(false)}
        centeredLayout={false}
      />
    </>
  );
}
export default HelpButton;

type HelpModalProps = {
  isModalOpen: boolean;
  centeredLayout: boolean;
  onCancel: () => void;
};

export function HelpModal(props: HelpModalProps) {
  const [helpText, setHelpText] = useState("");
  const positionStyle: CSSProperties = { right: 10, bottom: 40, top: "auto", position: "fixed" };

  const sendHelp = () => {
    props.onCancel();

    if (helpText.length > 0) {
      sendHelpEmail(helpText);
    }
  };

  return (
    <Modal
      title="Do you have any questions?"
      style={!props.centeredLayout ? positionStyle : undefined}
      open={props.isModalOpen}
      onOk={sendHelp}
      onCancel={props.onCancel}
      mask={props.centeredLayout}
      okText="Send"
      width={300}
    >
      <p>We are happy to help as soon as possible and will get back to you.</p>
      <Input.TextArea
        rows={6}
        value={helpText}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setHelpText(e.target.value)}
      />
    </Modal>
  );
}
