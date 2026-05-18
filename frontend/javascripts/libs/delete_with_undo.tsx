import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { UndoButton } from "libs/undo_button";

export const UNDO_SECONDS = 5;

export function deleteWithUndo<T extends { id: string }>({
  item,
  toastMessage,
  deleteApi,
  onDelete,
  onRestore,
}: {
  item: T;
  toastMessage: string;
  deleteApi: (id: string) => Promise<unknown>;
  onDelete: () => void;
  onRestore: () => void;
}): void {
  const toastKey = item.id;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  onDelete();

  const undo = () => {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    Toast.close(toastKey);
    onRestore();
  };

  Toast.info(toastMessage, {
    key: toastKey,
    sticky: true,
    customFooter: <UndoButton onUndo={undo} seconds={UNDO_SECONDS} />,
  });

  timeoutId = setTimeout(async () => {
    Toast.close(toastKey);
    try {
      await deleteApi(item.id);
    } catch (error) {
      handleGenericError(error as Error);
      onRestore();
    }
  }, UNDO_SECONDS * 1000);
}
