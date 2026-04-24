import { Modal, Tabs, type TabsProps } from "antd";

import { makeComponentLazy } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";

import { type ReactElement, useState } from "react";
import { DownloadAnnotationTab } from "./download_annotation_tab";
import { DownloadPythonTab } from "./download_python_tab";
import { TiffExportTab } from "./download_tiff_export_tab";

type TabKeys = "download" | "export" | "python";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  isAnnotation: boolean;
  initialTab?: TabKeys;
  initialBoundingBoxId?: number;
};

function _DownloadModalView({
  isOpen,
  onClose,
  isAnnotation,
  initialTab,
  initialBoundingBoxId,
}: Props): ReactElement {
  const annotation = useWkSelector((state) => state.annotation);
  const dataset = useWkSelector((state) => state.dataset);

  const typeName = isAnnotation ? "annotation" : "dataset";

  const [activeTabKey, setActiveTabKey] = useState<TabKeys>(initialTab ?? "download");

  // const handleOk = async () => {
  //   if (activeTabKey === "download") {
  //     await Model.ensureSavedState();
  //     const includeVolumeData = fileFormatToDownload === "wkw" || fileFormatToDownload === "zarr3";
  //     downloadAnnotation(
  //       annotation.annotationId,
  //       annotation.annotationType,
  //       hasVolumeFallback,
  //       undefined,
  //       fileFormatToDownload,
  //       includeVolumeData,
  //     );
  //     onClose();
  //   } else if (activeTabKey === "export" && startJob != null) {
  //     await Model.ensureSavedState();
  //     await startJob(async () => {
  //       const job = await startExportTiffJob(
  //         dataset.id,
  //         computeArrayFromBoundingBox(selectedBoundingBox.boundingBox),
  //         currentAdditionalCoordinates,
  //         selectedLayerInfos.layerName,
  //         mag.join("-"),
  //         selectedLayerInfos.annotationId,
  //         selectedLayerInfos.displayName,
  //         exportFormat === ExportFormat.OME_TIFF,
  //       );
  //       return [exportKey(selectedLayerInfos, mag), job.id];
  //     });

  //     if (!keepWindowOpen) {
  //       onClose();
  //     }
  //   }
  // };

  const handleTabChange = (key: string) => {
    setActiveTabKey(key as TabKeys);
  };

  const tabs: TabsProps["items"] = [
    {
      label: "TIFF Export",
      key: "export",
      children: (
        <TiffExportTab
          dataset={dataset}
          annotation={annotation}
          isAnnotation={isAnnotation}
          initialBoundingBoxId={initialBoundingBoxId}
        />
      ),
    },
    {
      label: "Python Client",
      key: "python",
      children: (
        <DownloadPythonTab isAnnotation={isAnnotation} annotation={annotation} dataset={dataset} />
      ),
    },
  ];
  if (isAnnotation)
    tabs.unshift({
      label: "Download",
      key: "download",
      children: <DownloadAnnotationTab annotation={annotation} isAnnotation={isAnnotation} />,
    });

  return (
    <Modal
      title={`Download this ${typeName}`}
      open={isOpen}
      width={600}
      footer={
        null
        // okText != null ? (
        //   <Button
        //     key="ok"
        //     type="primary"
        //     disabled={isOkButtonDisabled}
        //     onClick={handleOk}
        //     loading={isCurrentlyRunningExportJob}
        //   >
        //     {okText}
        //   </Button>
        //) : null
      }
      onCancel={onClose}
      style={{ overflow: "visible" }}
    >
      <Tabs activeKey={activeTabKey} onChange={handleTabChange} type="card" items={tabs} />
    </Modal>
  );
}

const DownloadModalView = makeComponentLazy(_DownloadModalView);
export default DownloadModalView;
