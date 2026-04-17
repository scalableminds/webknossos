import { Breadcrumb, theme } from "antd";
import type { DatasetCollectionContextValue } from "dashboard/dataset/dataset_collection_context";
import type { FolderItem } from "types/api_types";

/**
 * Renders an Antd Breadcrumb showing the path from the root folder to the
 * currently active folder. Each ancestor folder is a clickable link that
 * navigates directly to that folder. The breadcrumb
 * is hidden when the user is at the root level (path length ≤ 1).
 */
export function FolderBreadcrumb({ context }: { context: DatasetCollectionContextValue }) {
  const { token } = theme.useToken();
  const { data: folderHierarchy } = context.queries.folderHierarchyQuery;
  const { activeFolderId, setActiveFolderId } = context;

  if (activeFolderId == null || folderHierarchy == null) {
    return null;
  }

  const { itemById } = folderHierarchy;
  const path: FolderItem[] = [];
  let current: FolderItem | undefined = itemById[activeFolderId];

  while (current != null) {
    path.unshift(current);
    current = current.parent != null ? itemById[current.parent] : undefined;
  }

  if (path.length <= 1) {
    return null;
  }

  const items = path.map((folder, index) => {
    const isLast = index === path.length - 1;
    return {
      title: isLast ? (
        folder.title
      ) : (
        <a onClick={() => setActiveFolderId(folder.key)}>{folder.title}</a>
      ),
    };
  });

  return <Breadcrumb items={items} style={{ marginBottom: token.marginSM }} />;
}
