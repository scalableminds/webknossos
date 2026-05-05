import { updateNovelUserExperienceInfos } from "admin/rest_api";
import { Alert } from "antd";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useState } from "react";
import { useDispatch } from "react-redux";
import { setActiveUserAction } from "viewer/model/actions/user_actions";
import { HelpModal } from "./help_modal";

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
        title="Help"
        closable={{
          closeIcon: true,
          onClose: discardButton,
        }}
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
