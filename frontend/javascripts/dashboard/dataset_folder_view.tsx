import { DatasetExtentRow } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import React, { Component, useState } from "react";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { APIDataset, APIUser } from "types/api_flow_types";
import { TeamTags } from "./advanced_dataset/dataset_table";
import DatasetView from "./dataset_view";

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

class FolderSidebar extends Component<{}, State> {
  constructor(props: {}) {
    super(props);

    this.state = {
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
    };
  }

  render() {
    console.log("FileExplorerTheme", FileExplorerTheme);
    return (
      <div style={{ height: 400, width: 250 }}>
        <SortableTree
          treeData={this.state.treeData}
          onChange={(treeData) => this.setState({ treeData })}
          theme={FileExplorerTheme}
        />
      </div>
    );
  }
}
