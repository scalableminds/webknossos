import { sendHelpEmail, updateNovelUserExperienceInfos } from "admin/rest_api";
import { Alert, Input, Modal, message } from "antd";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import { useWkSelector } from "oxalis/store";
import type React from "react";
import { type CSSProperties, useState } from "react";
import { useDispatch } from "react-redux";

function HelpButton() {
  const [isModalOpen, setModalOpen] = useState(false);

  const dispatch = useDispatch();
  const activeUser = useWkSelector((state) => state.activeUser);

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
      />
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
  const [isSending, setIsSending] = useState(false);
  const positionStyle: CSSProperties = { right: 10, bottom: 40, top: "auto", position: "fixed" };

  const sendHelp = async () => {
    if (helpText.length > 0) {
      try {
        setIsSending(true);
        await sendHelpEmail(helpText);
        setHelpText("");
        message.success("Message has been sent. We'll reply via email shortly.");
      } catch (err) {
        message.error("Sorry, we could not send the help message. Please try again later.");
        throw err;
      } finally {
        setIsSending(false);
      }
    }
    props.onCancel();
  };

  return (
    <Modal
      title="Do you have any questions?"
      style={!props.centeredLayout ? positionStyle : undefined}
      open={props.isModalOpen}
      onOk={sendHelp}
      onCancel={props.onCancel}
      confirmLoading={isSending}
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
