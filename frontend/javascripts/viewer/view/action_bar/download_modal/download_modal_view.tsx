import { Modal, Tabs, type TabsProps } from "antd";

import { makeComponentLazy } from "libs/react_helpers";

import { type ReactElement, useState } from "react";
import { DownloadAnnotationTab } from "./download_annotation_tab";
import { DownloadPythonTab } from "./download_python_tab";
import { DownloadTiffTab } from "./download_tiff_export_tab";

type TabKeys = "download" | "export" | "python";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isAnnotation: boolean;
  initialTab?: TabKeys;
  initialBoundingBoxId?: number;
  initialLayerName?: string;
};

function _DownloadModalView({
  isOpen,
  onClose,
  isAnnotation,
  initialTab,
  initialBoundingBoxId,
  initialLayerName,
}: Props): ReactElement {
  const typeName = isAnnotation ? "annotation" : "dataset";

  const [activeTabKey, setActiveTabKey] = useState<TabKeys>(
    initialTab ?? (isAnnotation ? "download" : "export"),
  );

  const handleTabChange = (key: string) => {
    setActiveTabKey(key as TabKeys);
  };

  const tabs: TabsProps["items"] = [
    {
      label: "TIFF Export",
      key: "export",
      children: (
        <DownloadTiffTab
          isAnnotation={isAnnotation}
          initialBoundingBoxId={initialBoundingBoxId}
          initialLayerName={initialLayerName}
          onClose={onClose}
        />
      ),
    },
    {
      label: "Python Client",
      key: "python",
      children: <DownloadPythonTab isAnnotation={isAnnotation} />,
    },
  ];
  if (isAnnotation)
    tabs.unshift({
      label: "Download",
      key: "download",
      children: <DownloadAnnotationTab onClose={onClose} />,
    });

  return (
    <Modal
      title={`Download this ${typeName}`}
      open={isOpen}
      width={700}
      footer={null}
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Tabs activeKey={activeTabKey} onChange={handleTabChange} type="card" items={tabs} />
    </Modal>
  );
}

const DownloadModalView = makeComponentLazy(_DownloadModalView);
export default DownloadModalView;
