import { duplicateAnnotation } from "admin/rest_api";
import { Modal, Radio } from "antd";
import { useState } from "react";
import type { APIAnnotationType } from "types/api_types";

export function DuplicateAnnotationModal({
  annotationId,
  annotationType,
  open,
}: {
  annotationId: string;
  annotationType: APIAnnotationType;
  open: boolean;
}) {
  const [openInNewTab, setOpenInNewTab] = useState(true);
  return (
    <Modal
      title="Duplicate Annotation"
      open={open}
      onOk={async () => {
        const newAnnotation = await duplicateAnnotation(annotationId, annotationType);
        window.open(`/annotations/${newAnnotation.id}`, openInNewTab ? "_blank" : "_self");
      }}
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
