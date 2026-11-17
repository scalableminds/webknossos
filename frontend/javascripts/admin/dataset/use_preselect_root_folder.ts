import type { FormInstance } from "antd";
import { useFolderHierarchyQuery } from "dashboard/dataset/queries";
import { useEffect, useRef } from "react";

/**
 * Preselects the organization's root folder in the form's `targetFolderId` field if no folder was set
 * otherwise (e.g., via the `?to=` URL parameter), so that the required folder field isn't empty.
 * Once the user changed the field, their choice is kept.
 */
export function usePreselectRootFolder(form: FormInstance) {
  const { data: hierarchy } = useFolderHierarchyQuery();
  const preselectedFolderId = useRef<string | null>(null);

  useEffect(() => {
    if (hierarchy == null || form.isFieldTouched("targetFolderId")) return;
    // Keep a folder that was set otherwise (e.g., via the URL or by continuing an unfinished upload).
    // Only redo the own preselection, as it may stem from an outdated, cached hierarchy.
    const currentFolderId: string | null = form.getFieldValue("targetFolderId");
    if (currentFolderId != null && currentFolderId !== preselectedFolderId.current) return;

    // Each organization has exactly one root folder, which is the only item without a parent.
    const rootFolder = hierarchy.tree[0];
    preselectedFolderId.current = rootFolder?.isEditable ? rootFolder.key : null;
    // Unlike setFieldsValue, setFields can keep the field untouched. Otherwise, the next run of this
    // effect would treat the own preselection as a choice of the user and never update it.
    form.setFields([
      { name: "targetFolderId", value: preselectedFolderId.current ?? undefined, touched: false },
    ]);
  }, [hierarchy, form]);
}
