import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFolder, getFolderTree } from "admin/api/folders";
import Toast from "libs/toast";
import { DatasetExtentRow } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import React, { useState } from "react";
import SortableTree from "react-sortable-tree";
// @ts-ignore
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { APIDataset, APIUser, Folder } from "types/api_flow_types";
import { TeamTags } from "./advanced_dataset/dataset_table";
import DatasetView from "./dataset_view";

function useFolderTreeQuery() {
  return useQuery(["folders"], getFolderTree, {
    refetchOnWindowFocus: false,
  });
}

function useCreateFolderMutation() {
  const queryClient = useQueryClient();
  const mutationKey = ["folders"];

  return useMutation(([parentId, name]: [string, string]) => createFolder(parentId, name), {
    mutationKey,
    onSuccess: (newFolder) => {
      queryClient.setQueryData(mutationKey, (oldItems: Folder[] | undefined) =>
        (oldItems || []).concat([newFolder]),
      );
    },
    onError: (err) => {
      Toast.error(`Could not create folder. ${err}`);
    },
  });
}

type Props = {
  user: APIUser;
};
export function DatasetFolderView(props: Props) {
  const [selectedDataset, setSelectedDataset] = useState<APIDataset | null>(null);

  return (
    <div style={{ display: "grid", gridTemplate: "auto 1fr auto / auto 1fr auto" }}>
      <div style={{ gridColumn: "1 / 2" }}>
        <FolderSidebar />
      </div>
      <main style={{ gridColumn: "2 / 2" }}>
        <DatasetView
          user={props.user}
          onSelectDataset={setSelectedDataset}
          selectedDataset={selectedDataset}
        />
      </main>
      <div style={{ gridColumn: "3 / 4" }}>
        <DatasetDetailsSidebar selectedDataset={selectedDataset} />
      </div>
    </div>
  );
}

function DatasetDetailsSidebar({ selectedDataset }: { selectedDataset: APIDataset | null }) {
  // allowedTeams: Array<APITeam>;
  // created: number;
  // description: string | null | undefined;
  // isPublic: boolean;

  // owningOrganization: string;
  // publication: null | undefined;
  // tags: Array<string>;

  return (
    <div style={{ width: 300 }}>
      {selectedDataset != null ? (
        <>
          <h1>{selectedDataset.displayName || selectedDataset.name}</h1>
          Description: {selectedDataset.description}
          <div className="info-tab-block">
            <table
              style={{
                fontSize: 14,
              }}
            >
              <tbody>
                <DatasetExtentRow dataset={selectedDataset} />
              </tbody>
            </table>
          </div>
          Access Permissions:
          <TeamTags dataset={selectedDataset} />
        </>
      ) : (
        "No dataset selected"
      )}
    </div>
  );
}

type FolderItem = {
  title: string;
  expanded?: boolean;
  children?: FolderItem[];
};

type State = {
  treeData: FolderItem[];
};

function FolderSidebar() {
  const [state, setState] = useState<State>({
    treeData: [
      {
        title: "Root",
        expanded: true,
        children: [
          {
            title: "Folder 1",
            expanded: true,
            children: [
              { title: "Subfolder A.js" },
              { title: "Subfolder B" },
              { title: "Subfolder C" },
            ],
          },
          { title: "Folder 2" },
          { title: "Folder 3" },
        ],
      },
    ],
  });

  const { error, data: folderTree, isLoading } = useFolderTreeQuery();

  const createFolderMutation = useCreateFolderMutation();
  const createFolder = () => {
    if (folderTree && folderTree.length > 0) {
      createFolderMutation.mutateAsync([folderTree[0].id, "New Folder"]);
    }
  };

  console.log("folderTree", folderTree);

  console.log("FileExplorerTheme", FileExplorerTheme);
  return (
    <div style={{ height: 400, width: 250 }}>
      <SortableTree
        treeData={state.treeData}
        onChange={(treeData) => setState({ treeData })}
        theme={FileExplorerTheme}
      />
      <button onClick={createFolder}>Create</button>
    </div>
  );
}
