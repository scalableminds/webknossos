import React, { Component } from "react";
import SortableTree from "react-sortable-tree";
import FileExplorerTheme from "react-sortable-tree-theme-file-explorer";

import { APIUser } from "types/api_flow_types";
import DatasetView from "./dataset_view";

type Props = {
  user: APIUser;
};
export function DatasetFolderView(props: Props) {
  return (
    <div style={{ display: "grid", gridTemplate: "auto 1fr auto / auto 1fr auto" }}>
      <div style={{ gridColumn: "1 / 2" }}>
        <FolderSidebar />
      </div>
      <main style={{ gridColumn: "2 / 2" }}>
        <DatasetView user={props.user} />
      </main>
      <div style={{ gridColumn: "3 / 4" }}>Right Sidebar</div>
    </div>
  );
}

class FolderSidebar extends Component {
  constructor(props) {
    super(props);

    this.state = {
      treeData: [
        {
          title: "Root/",
          expanded: true,
          children: [
            {
              title: "Folder 1",
              expanded: true,
              children: [
                { title: "Subfolder A" },
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
      <div style={{ height: 400, width: 400 }}>
        <SortableTree
          treeData={this.state.treeData}
          onChange={(treeData) => this.setState({ treeData })}
          theme={FileExplorerTheme}
        />
      </div>
    );
  }
}
