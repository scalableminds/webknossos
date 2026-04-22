import { duplicateAnnotation } from "admin/rest_api";
import { Button, Modal } from "antd";
import { sleep } from "libs/utils";
import { useMemo, useState } from "react";
import { useDispatch } from "react-redux";
import type { APIAnnotationType } from "types/api_types";
import { setDuplicateAnnotationModalVisibilityAction } from "viewer/model/actions/ui_actions";

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
  // Force remount of the inner component to reset its state when the modal is opened again
  return open ? (
    <DuplicateAnnotationModalInner
      annotationId={annotationId}
      annotationType={annotationType}
      open={open}
      copyToOwnAccount={copyToOwnAccount}
    />
  ) : null;
}

function DuplicateAnnotationModalInner({
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
  const [isError, setIsError] = useState(false);
  const dispatch = useDispatch();
  const toOwnAccountText = copyToOwnAccount ? " to your account" : "";
  const handleClose = () => {
    dispatch(setDuplicateAnnotationModalVisibilityAction(false));
  };
  const modalContent = useMemo(() => {
    if (isLoading) {
      return `Copying annotation${toOwnAccountText}...`;
    } else if (newAnnotation) {
      return `The annotation was copied successfully${toOwnAccountText}.`;
    } else if (isError) {
      return `Failed to copy annotation${toOwnAccountText}.`;
    }
  }, [isLoading, newAnnotation, toOwnAccountText, isError]);

  const openAnnotationButton = (
    <Button
      loading={isLoading}
      disabled={isError}
      type="primary"
      href={`/annotations/${newAnnotation}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => dispatch(setDuplicateAnnotationModalVisibilityAction(false))}
    >
      Open
    </Button>
  );
  return (
    <Modal
      open={open}
      afterOpenChange={async (open) => {
        if (open) {
          setIsLoading(true);
          try {
            const { id: newAnnotationId } = await duplicateAnnotation(annotationId, annotationType);
            setNewAnnotation(newAnnotationId);
          } catch (error) {
            console.error("Failed to duplicate annotation", error);
            setIsError(true);
          } finally {
            await sleep(3000);
            setIsLoading(false);
          }
        }
      }}
      footer={openAnnotationButton}
      onCancel={handleClose}
    >
      <div
        style={{
          fontSize: 20,
          paddingTop: 13,
          textAlign: "center",
        }}
      >
        {modalContent}
      </div>
    </Modal>
  );
}
