import { duplicateAnnotation } from "admin/rest_api";
import { Button, Modal } from "antd";
import { sleep } from "libs/utils";
import { useState } from "react";
import type { APIAnnotationType } from "types/api_types";
import { setDuplicateAnnotationModalVisibilityAction } from "viewer/model/actions/ui_actions";
import { Store } from "viewer/singletons";

export function DuplicateAnnotationModal({
  annotationId,
  annotationType,
  open,
  copyToOwnAccount,
}: {
  annotationId: string;
  annotationType: APIAnnotationType;
  open: boolean;
  copyToOwnAccount: boolean;
}) {
  const [isLoading, setIsLoading] = useState(true);
  const [newAnnotation, setNewAnnotation] = useState<null | string>(null);
  const toOwnAccountText = copyToOwnAccount ? " to your account" : "";
  const modalContent = () => {
    if (isLoading) {
      return `Copying annotation${toOwnAccountText}...`;
    } else if (newAnnotation) {
      return `The annotation was copied successfully${toOwnAccountText}.`;
    }
  };
  const openAnnotationButton = (
    <Button
      loading={isLoading}
      type="primary"
      href={`/annotations/${newAnnotation}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => Store.dispatch(setDuplicateAnnotationModalVisibilityAction(false))}
    >
      Open
    </Button>
  );
  return (
    <Modal
      closable={false}
      title="Duplicate Annotation"
      open={open}
      afterOpenChange={async (open) => {
        if (open) {
          setIsLoading(true);
          const { id: newAnnotationId } = await duplicateAnnotation(annotationId, annotationType);
          setNewAnnotation(newAnnotationId);
          await sleep(10000);
          setIsLoading(false);
        }
      }}
      confirmLoading={isLoading}
      footer={openAnnotationButton}
    >
      {modalContent()}
    </Modal>
  );
}
