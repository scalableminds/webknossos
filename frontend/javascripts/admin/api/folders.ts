import Request from "libs/request";
import type { Folder, FlatFolderTreeItem, FolderUpdater } from "types/api_flow_types";

export function getFolder(folderId: string): Promise<Folder> {
  return Request.receiveJSON(`/api/folders/${folderId}`);
}

export function getFolderTree(): Promise<FlatFolderTreeItem[]> {
  return Request.receiveJSON("/api/folders/tree");
}

export async function createFolder(parentId: string, name: string): Promise<Folder> {
  const params = new URLSearchParams();
  params.append("parentId", parentId);
  params.append("name", name);

  const folder = await Request.receiveJSON(`/api/folders/create?${params}`, {
    method: "POST",
  });
  return folder;
}

export async function deleteFolder(id: string): Promise<string> {
  await Request.receiveJSON(`/api/folders/${id}`, {
    method: "DELETE",
  });
  // Return deleted id
  return id;
}

export function updateFolder(folder: FolderUpdater): Promise<Folder> {
  return Request.sendJSONReceiveJSON(`/api/folders/${folder.id}`, {
    data: folder,
    method: "PUT",
  });
}

export function moveFolder(folderId: string, newParentId: string): Promise<Folder> {
  const params = new URLSearchParams();
  params.append("newParentId", newParentId);
  return Request.sendJSONReceiveJSON(`/api/folders/${folderId}/move?${params}`, {
    data: {},
    method: "PUT",
  });
}
