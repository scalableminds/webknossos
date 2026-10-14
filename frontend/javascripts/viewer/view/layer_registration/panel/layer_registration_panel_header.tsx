import { ArrowLeftOutlined, CheckOutlined, LoadingOutlined, MoreOutlined } from "@ant-design/icons";
import { Button, Dropdown, Flex, type MenuProps, Tooltip, Typography, theme } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";
import constants from "viewer/constants";
import { MarkdownModal } from "viewer/view/components/markdown_modal";
import type { SaveState } from "../layer_registration_protocol";
import type { LandmarkExportFormat } from "../workspace/layer_registration_landmark_export";

// Saving is automatic, so the save state is only shown. "Save now" saves right away, e.g.
// before the page is closed.
function SaveStateIndicator({
  saveState,
  onSave,
}: {
  saveState: SaveState;
  onSave: () => Promise<void>;
}) {
  const style = { fontSize: 12, whiteSpace: "nowrap" } as const;
  switch (saveState) {
    case "saved":
      return (
        <Typography.Text type="secondary" style={style}>
          <CheckOutlined /> Saved
        </Typography.Text>
      );
    case "saving":
      return (
        <Typography.Text type="secondary" style={style}>
          <LoadingOutlined /> Saving…
        </Typography.Text>
      );
    case "unsaved":
      return (
        <Flex align="center">
          <Typography.Text type="secondary" style={style}>
            Unsaved
          </Typography.Text>
          <Button type="link" size="small" onClick={onSave}>
            Save now
          </Button>
        </Flex>
      );
  }
}

/** The header of the landmark panel. Everything in it belongs to the whole layer registration
 * annotation: its name, its save state, and the actions of the "more" menu.
 */
export function LayerRegistrationPanelHeader({
  name,
  description,
  onChangeName,
  onChangeDescription,
  saveState,
  onSave,
  canDownloadLandmarks,
  onDownloadLandmarks,
  layerRegistrationListUrl,
}: {
  name: string;
  description: string;
  onChangeName: (name: string) => void;
  onChangeDescription: (description: string) => void;
  saveState: SaveState;
  onSave: () => Promise<void>;
  // Only complete pairs are downloaded, so there must be one.
  canDownloadLandmarks: boolean;
  onDownloadLandmarks: (format: LandmarkExportFormat) => void;
  // The page that lists the layer registrations of the dataset.
  layerRegistrationListUrl: string;
}) {
  const { token } = theme.useToken();
  // Navigating asks first if the landmarks aren't saved yet (see the blocker in
  // layer_registration_workspace.tsx).
  const navigate = useNavigate();
  const [isRenaming, setIsRenaming] = useState(false);
  const [isDescriptionModalOpen, setIsDescriptionModalOpen] = useState(false);

  const menuItems: MenuProps["items"] = [
    { key: "rename", label: "Rename", onClick: () => setIsRenaming(true) },
    {
      key: "description",
      label: "Edit description",
      onClick: () => setIsDescriptionModalOpen(true),
    },
    {
      key: "download",
      label: "Download landmarks",
      disabled: !canDownloadLandmarks,
      // Both formats can be uploaded in the dataset composition wizard.
      children: [
        {
          key: "csv" satisfies LandmarkExportFormat,
          label: "BigWarp CSV",
          onClick: () => onDownloadLandmarks("csv"),
        },
        {
          key: "nml" satisfies LandmarkExportFormat,
          label: "NML files (one per layer)",
          onClick: () => onDownloadLandmarks("nml"),
        },
      ],
    },
    { type: "divider" },
    {
      key: "list",
      label: "All layer registrations of this dataset",
      onClick: () => navigate(layerRegistrationListUrl),
    },
  ];

  return (
    <Flex
      align="center"
      gap={4}
      style={{
        // Its bottom border continues the bottom border of the views' navbars.
        flex: "none",
        boxSizing: "border-box",
        height: constants.DEFAULT_NAVBAR_HEIGHT,
        padding: `0 ${token.paddingXS}px`,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Tooltip title="All layer registrations of this dataset">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          aria-label="All layer registrations of this dataset"
          onClick={() => navigate(layerRegistrationListUrl)}
        />
      </Tooltip>
      <Typography.Text
        strong
        // Takes the width that the other elements leave free.
        style={{ flex: 1, minWidth: 0, margin: 0 }}
        ellipsis={isRenaming ? false : { tooltip: true }}
        editable={{
          editing: isRenaming,
          // Started from the "more" menu only.
          triggerType: [],
          text: name,
          onChange: (newName) => {
            setIsRenaming(false);
            if (newName !== "" && newName !== name) {
              onChangeName(newName);
            }
          },
          onCancel: () => setIsRenaming(false),
        }}
      >
        {name !== "" ? name : "Unnamed layer registration"}
      </Typography.Text>
      <SaveStateIndicator saveState={saveState} onSave={onSave} />
      <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="More actions" />
      </Dropdown>
      <MarkdownModal
        label="Layer Registration Description"
        placeholder="[No description]"
        source={description}
        isOpen={isDescriptionModalOpen}
        onOk={() => setIsDescriptionModalOpen(false)}
        onChange={onChangeDescription}
      />
    </Flex>
  );
}
