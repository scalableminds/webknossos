import { updateNovelUserExperienceInfos } from "admin/admin_rest_api";
import { Button, Modal } from "antd";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import type { OxalisState } from "oxalis/store";
import * as React from "react";
import { useDispatch, useSelector } from "react-redux";

export default function PresentModernControls() {
  const dispatch = useDispatch();
  const activeUser = useSelector((state: OxalisState) => state.activeUser);
  const [isModalVisible, setIsModalVisible] = React.useState(
    activeUser?.novelUserExperienceInfos.shouldSeeModernControlsModal,
  );

  if (!isModalVisible) {
    return null;
  }

  const closeModal = () => {
    setIsModalVisible(false);
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'APIUser | null | undefined' is n... Remove this comment to see the full error message
    updateNovelUserExperienceInfos(activeUser, {
      shouldSeeModernControlsModal: false,
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
    <Modal maskClosable={false} open onCancel={closeModal} width={800} footer={null}>
      <h1>Say Hello to the Context Menu</h1>
      <p>
        WEBKNOSSOS now provides an easy-to-use context menu that allows performing even complex
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
        <Button
          type="primary"
          onClick={handleEnableContextMenu}
          style={{
            marginRight: 12,
          }}
        >
          Enable the Context Menu
        </Button>

        <Button onClick={handleKeepClassicControls}>Keep the Classic Controls</Button>
      </div>
      <p
        style={{
          color: "var(--ant-color-text-secondary)",
          fontSize: 12,
          textAlign: "center",
          margin: "8px auto",
          maxWidth: 500,
        }}
      >
        Note that you can always change your mind by enabling/disabling &quot;Classic Controls&quot;
        in the settings sidebar. Read more about the setting{" "}
        <a
          href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html#classic-controls"
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
