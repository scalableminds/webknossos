// @flow

import { Modal, Button } from "antd";
import * as React from "react";
import { useSelector, useDispatch } from "react-redux";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { updateNovelUserExperienceInfos } from "admin/admin_rest_api";

export default function PresentModernControls() {
  const dispatch = useDispatch();
  const activeUser = useSelector(state => state.activeUser);
  const [isModalVisible, setIsModalVisible] = React.useState(
    activeUser != null && !activeUser.novelUserExperienceInfos.hasSeenModernControlsModal,
  );
  if (!isModalVisible) {
    return null;
  }

  const closeModal = () => {
    setIsModalVisible(false);
    updateNovelUserExperienceInfos(activeUser, {
      hasSeenModernControlsModal: true,
    });
  };

  const handleEnableContextMenu = () => {
    dispatch(updateUserSettingAction("useLegacyBindings", false));
    closeModal();
  };

  const handleKeepClassicControls = () => {
    dispatch(updateUserSettingAction("useLegacyBindings", true));
    closeModal();
  };

  return (
    <Modal maskClosable={false} visible onCancel={closeModal} width={800} footer={null}>
      <h1>Say Hello to the Context Menu</h1>
      <p>
        webKnossos now provides an easy-to-use context menu that allows performing even complex
        actions, such as merging two trees, intuitively. Simply right-click an element of interest
        (e.g., a node or segment) to see available actions.
      </p>
      <img
        src="/assets/images/novel_user_experiences/01-context-menu.png"
        alt="Context Menu showing actions for nodes and segments"
        style={{
          margin: "24px auto",
          display: "block",
          borderRadius: 3,
        }}
      />
      <p>
        Previously, the right-click was reserved for certain actions, such as creating a node or
        erasing volume data. These actions are now available in their respective tool via left-click
        (e.g., using the dedicated erase tool) or happen automatically (e.g., selecting a node
        doesn’t require holding shift anymore).
      </p>
      <div className="center-item-using-flex">
        <Button type="primary" onClick={handleEnableContextMenu} style={{ marginRight: 12 }}>
          Enable the Context Menu
        </Button>

        <Button onClick={handleKeepClassicControls}>Keep the Classic Controls</Button>
      </div>
      <p
        style={{
          color: "var(--ant-text-secondary)",
          fontSize: 12,
          textAlign: "center",
          margin: "8px auto",
          maxWidth: 500,
        }}
      >
        Note that you can always change your mind by enabling/disabling &quot;Classic Controls&quot;
        in the settings sidebar. Read more about the setting{" "}
        <a
          href="https://docs.webknossos.org/reference/keyboard_shortcuts#classic-controls"
          target="_blank"
          rel="noopener noreferrer"
        >
          here
        </a>
        .
      </p>
    </Modal>
  );
}
