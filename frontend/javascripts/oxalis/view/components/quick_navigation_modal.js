// @flow

import React, { useState } from "react";
import Shortcut from "libs/shortcut_component";
import { Modal, AutoComplete } from "antd";
import { type RouterHistory, withRouter } from "react-router-dom";

const dataSource = [
  { text: "My Datasets", value: "/dashboard/datasets" },
  { text: "My Dashboard", value: "/dashboard" },
  { text: "My Tasks", value: "/dashboard/tasks" },
  { text: "My Annotations", value: "/dashboard/annotations" },
  { text: "Shared Annotations", value: "dashboard/shared" },
  { text: "Users Administration", value: "/users" },
  { text: "Teams Administration", value: "/teams" },
  { text: "Projects Administration", value: "/projects" },
  { text: "Task Administration", value: "/tasks" },
  { text: "Task Types Administration", value: "/taskTypes" },
  { text: "Scripts Administration", value: "/scripts" },
  { text: "Statistics Overview", value: "/statistics" },
  { text: "Time Tracking", value: "/reports/timetracking" },
  { text: "Project Progress", value: "/reports/projectProgress" },
  { text: "Open Tasks", value: "/reports/openTasks" },
  { text: "User Documentation", value: "docs.webkossos.org" },
  { text: "Community Support", value: "forum.image.sc/tag/webknossos" },
  { text: "Frontend API", value: "/assets/docs/frontend-api/index.html" },
  { text: "Keyboard Shortcuts", value: "docs.webknossos.org/reference/keyboard_shortcuts" },
];

type Props = {
  history: RouterHistory,
};

function QuickNavigationModal({ history }: Props) {
  const [showNavigationModal, setShowNavigationModal] = useState(false);

  const toggleNavigationModal = () => {
    console.log("called");
    if (document.activeElement != null && showNavigationModal) {
      document.activeElement.blur();
    }
    setShowNavigationModal(!showNavigationModal);
  };

  const navigateTo = (path: string) => {
    history.push(path);
  };

  return (
    <React.Fragment>
      <Shortcut keys="ctrl + e" onTrigger={toggleNavigationModal} />
      <Modal
        title="Quick Navigation ..."
        visible={showNavigationModal}
        onOk={toggleNavigationModal}
        onCancel={toggleNavigationModal}
        className="no-footer-modal"
        autoFocus
      >
        <AutoComplete
          style={{ width: "100%" }}
          dataSource={dataSource}
          placeholder="Jump to ..."
          filterOption={(inputValue, option) =>
            option.props.children.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
          }
          onSelect={value => navigateTo(value)}
          autoFocus
          dropdownMenuStyle={{ maxHeight: 250, overflowY: "auto" }}
        />
      </Modal>
    </React.Fragment>
  );
}

export default withRouter(QuickNavigationModal);
