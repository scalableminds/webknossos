import { duplicateAnnotation } from "admin/rest_api";
import { Modal, Radio } from "antd";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import { useState } from "react";
import type { APIAnnotationType } from "types/api_types";
import { Model } from "viewer/singletons";

export function DuplicateAnnotationModal({
  annotationId,
  annotationType,
  open,
  onClose,
}: {
  annotationId: string;
  annotationType: APIAnnotationType;
  open: boolean;
  onClose: () => void;
}) {
  const [openInNewTab, setOpenInNewTab] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  return (
    <Modal
      title="Duplicate Annotation"
      open={open}
      onOk={async () => {
        setIsLoading(true);
        await Model.ensureSavedState();
        try {
          const newAnnotation = await duplicateAnnotation(annotationId, annotationType);
          await sleep(10000);
          window.open(
            `/annotations/${newAnnotation.id}`,
            openInNewTab ? "_blank" : "_self",
            "noopener noreferrer",
          );
        } catch (error) {
          Toast.error("Failed to duplicate annotation. See console for details.");
          console.error("Error duplicating annotation:", error);
        }
        setIsLoading(false);
        onClose();
      }}
      onCancel={onClose}
      confirmLoading={isLoading}
    >
      <Radio.Group
        onChange={(e) => setOpenInNewTab(e.target.value === "newTab")}
        value={openInNewTab ? "newTab" : "thisTab"}
        options={[
          { label: "Open in Current Tab", value: "thisTab" },
          { label: "Open in New Tab", value: "newTab" },
        ]}
      ></Radio.Group>
    </Modal>
  );
}
