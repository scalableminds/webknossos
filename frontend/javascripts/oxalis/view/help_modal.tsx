import { updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import { Alert, Modal } from "antd";
import { setActiveUserAction } from "oxalis/model/actions/user_actions";
import type { OxalisState } from "oxalis/store";
import type React from "react";
import { useState } from "react";
import { useDispatch, useSelector } from "react-redux";

function HelpButton() {
  const [isModalOpen, setModalOpen] = useState(false);
  const dispatch = useDispatch();
  const activeUser = useSelector((state: OxalisState) => state.activeUser);

  const discardButton = (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
    e.stopPropagation();
    if (!activeUser) return;

    const [newUserSync] = updateNovelUserExperienceInfos(activeUser, {
      hasDiscardedHelpButton: true,
    });
    dispatch(setActiveUserAction(newUserSync));
  };

  if (!activeUser || activeUser.novelUserExperienceInfos.hasDiscardedHelpButton) return null;

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
      <HelpChatModal isModalOpen={isModalOpen} onCancel={() => setModalOpen(false)} />
    </>
  );
}
export default HelpButton;

type HelpChatModalProps = {
  isModalOpen: boolean;
  onCancel: () => void;
};

export function HelpChatModal({ isModalOpen, onCancel }: HelpChatModalProps) {


  return (
    <Modal
      title="AI Help Chat"
      open={isModalOpen}
      onCancel={onCancel}
      footer={null}
      style={{ position: "fixed", bottom: 40, right: 40 }}
      bodyStyle={{ padding: 0, margin: 0, height: "70vh" }} // Remove padding & force height
    >
      <iframe
        src="https://docsbot.ai/iframe/rfzK8JdNB7qcmTsCndEH/NpvQFUvCqNIGvaxucpwU"
        width="100%"
        height="100%"
        frameBorder="0"
        allowTransparency={true}
        scrolling="no"
        style={{ display: "block", border: "none", padding: "0px", margin: "0px" }}
      />
    </Modal>
  );
}
