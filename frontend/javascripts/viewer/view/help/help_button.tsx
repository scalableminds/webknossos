import { Alert } from "antd";
import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";
import { HelpModal } from "./help_modal";

function HelpButton() {
  const [isModalOpen, setModalOpen] = useState(false);

  const activeUser = useWkSelector((state) => state.activeUser);

  if (!activeUser) return null;

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
