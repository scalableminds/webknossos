// @flow

import React, { useState, useEffect } from "react";
import Shortcut from "libs/shortcut_component";
import { Modal, AutoComplete } from "antd";
import { location } from "libs/window";
import { useHistory } from "react-router-dom";
import { useSelector } from "react-redux";
import features from "features";

const defaultNavigations = [
  { text: "My Datasets", value: "/dashboard/datasets" },
  { text: "My Dashboard", value: "/dashboard" },
  { text: "My Tasks", value: "/dashboard/tasks" },
  { text: "My Annotations", value: "/dashboard/annotations" },
  { text: "Shared Annotations", value: "/dashboard/shared" },
  { text: "Time Tracking", value: "/reports/timetracking" },
  { text: "Frontend API", value: "/assets/docs/frontend-api/index.html" },
  { text: "Add Script", value: "/scripts/create" },
  { text: "Change Password", value: "/auth/changePassword" },
  { text: "Show Auth Token", value: "/auth/token" },
  // TODO: Add more
  { text: "User Documentation", value: "https://docs.webknossos.org" },
  { text: "Community Support", value: "https://forum.image.sc/tag/webknossos" },
  { text: "Keyboard Shortcuts", value: "https://docs.webknossos.org/reference/keyboard_shortcuts" },
];

const getDatasetManagerAndAdminNavigations = (owningOrganization: string, datasetName: string) => {
  const navigations = [
    { text: "Add / Upload Dataset", value: "/datasets/upload" },
    { text: "Create Task Type", value: "/taskTypes/create" },
    { text: "Users Administration", value: "/users" },
    { text: "Teams Administration", value: "/teams" },
    { text: "Projects Administration", value: "/projects" },
    { text: "Task Administration", value: "/tasks" },
    { text: "Task Types Administration", value: "/taskTypes" },
    { text: "Scripts Administration", value: "/scripts" },
    { text: "Statistics Overview", value: "/statistics" },
    { text: "Open Tasks", value: "/reports/openTasks" },
    { text: "Project Progress", value: "/reports/projectProgress" },
  ];
  if (features().jobsEnabled) {
    navigations.push({ text: "Show Processing Jobs", value: "/jobs" });
  }
  if (datasetName !== "Test Dataset") {
    navigations.push({
      text: "Edit Current Dataset's Settings",
      value: `/datasets/${owningOrganization}/${datasetName}/edit`,
    });
  }
  return navigations;
};

function getDataSource(isAdmin, isDatasetManager, owningOrganization, datasetName) {
  if (!isAdmin || !isDatasetManager) {
    return defaultNavigations;
  }
  return [
    ...defaultNavigations,
    ...getDatasetManagerAndAdminNavigations(owningOrganization, datasetName),
  ];
}

export default function QuickNavigationModal() {
  const [showNavigationModal, setShowNavigationModal] = useState(false);
  const history = useHistory();
  const owningOrganization = useSelector(state => state.dataset.owningOrganization);
  const datasetName = useSelector(state => state.dataset.name);
  const activeUser = useSelector(state => state.activeUser);
  let dataSource = [];
  useEffect(() => {
    dataSource = getDataSource(
      activeUser.isAdmin,
      activeUser.isDatasetManager,
      owningOrganization,
      datasetName,
    );
  });
  if (!activeUser) {
    return null;
  }
  dataSource = getDataSource(
    activeUser.isAdmin,
    activeUser.isDatasetManager,
    owningOrganization,
    datasetName,
  );

  const toggleNavigationModal = () => {
    if (document.activeElement != null && showNavigationModal) {
      document.activeElement.blur();
    }
    setShowNavigationModal(!showNavigationModal);
  };

  const navigateTo = (path: string) => {
    toggleNavigationModal();
    if (path.startsWith("/")) {
      history.push(path);
    } else {
      location.assign(path);
    }
  };

  console.log(dataSource);

  return (
    <React.Fragment>
      <Shortcut keys="ctrl + e" onTrigger={toggleNavigationModal} supportInputElements />
      <Modal
        title="Quick Navigation ..."
        visible={showNavigationModal}
        onOk={toggleNavigationModal}
        onCancel={toggleNavigationModal}
        className="no-footer-modal"
        autoFocus
      >
        {showNavigationModal ? (
          // Remounting the component each time to easily clear it, auto focus it and open the dropdown by default.
          <AutoComplete
            style={{ width: "100%" }}
            dataSource={dataSource}
            placeholder="Jump to ..."
            filterOption={(inputValue, option) =>
              option.props.children.toLowerCase().indexOf(inputValue.toLowerCase()) !== -1
            }
            onSelect={value => navigateTo(value)}
            dropdownMenuStyle={{ maxHeight: 250, overflowY: "auto" }}
            autoFocus
            defaultOpen
          />
        ) : null}
      </Modal>
    </React.Fragment>
  );
}
