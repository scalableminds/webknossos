import { EyeOutlined, FileTextOutlined, SyncOutlined, TeamOutlined } from "@ant-design/icons";
import { JobState, getShowTrainingDataLink } from "admin/job/job_list_view";
import { getAiModels, getUsersOrganizations, updateAiModel } from "admin/rest_api";
import { Button, Col, Modal, Row, Select, Table, Typography } from "antd";
import FormattedDate from "components/formatted_date";
import { PageNotAvailableToNormalUser } from "components/permission_enforcer";
import { useFetch, useGuardedFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import _ from "lodash";
import { useState } from "react";
import type { Key } from "react";
import { formatUserName } from "viewer/model/accessors/user_accessor";

import { Link } from "react-router-dom";
import type { AiModel } from "types/api_types";

export default function AiModelListView() {
  const activeUser = useWkSelector((state) => state.activeUser);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [currentlyEditedModel, setCurrentlyEditedModel] = useState<AiModel | null>(null);
  const [aiModels, isLoading] = useGuardedFetch(
    getAiModels,
    [],
    [refreshCounter],
    "Could not load model list.",
  );

  if (!activeUser?.isSuperUser) {
    return <PageNotAvailableToNormalUser />;
  }

  return (
    <div className="container voxelytics-view">
      {currentlyEditedModel ? (
        <EditModelSharedOrganizationsModal
          model={currentlyEditedModel}
          onClose={() => {
            setCurrentlyEditedModel(null);
            setRefreshCounter((val) => val + 1);
          }}
          owningOrganization={activeUser.organization}
        />
      ) : null}
      <div className="pull-right">
        <Button onClick={() => setRefreshCounter((val) => val + 1)}>
          <SyncOutlined spin={isLoading} /> Refresh
        </Button>
      </div>
      <h3>AI Models</h3>
      <Table
        bordered
        rowKey={(run: AiModel) => `${run.id}`}
        pagination={{ pageSize: 100 }}
        columns={[
          {
            title: "Name",
            dataIndex: "name",
            key: "name",
          },
          {
            title: "Created at",
            key: "created",
            defaultSortOrder: "descend",
            sorter: (a: AiModel, b: AiModel) => a.created - b.created,
            render: (model: AiModel) => <FormattedDate timestamp={model.created} />,
          },
          {
            title: "User",
            dataIndex: "user",
            key: "user",
            render: (user: AiModel["user"]) => formatUserName(activeUser, user),
            filters: _.uniq(aiModels.map((model) => formatUserName(null, model.user))).map(
              (username) => ({
                text: username,
                value: username,
              }),
            ),
            onFilter: (value: Key | boolean, model: AiModel) =>
              formatUserName(null, model.user).startsWith(String(value)),
            filterSearch: true,
          },
          {
            title: "Status",
            dataIndex: "trainingJob",
            key: "status",
            render: (trainingJob: AiModel["trainingJob"]) =>
              trainingJob && <JobState job={trainingJob} />,
          },
          {
            title: "Comment",
            dataIndex: "comment",
            key: "comment",
          },
          {
            title: "Actions",
            render: (aiModel: AiModel) =>
              renderActionsForModel(aiModel, () => setCurrentlyEditedModel(aiModel)),
            key: "actions",
          },
        ]}
        dataSource={aiModels}
      />
    </div>
  );
}

const renderActionsForModel = (model: AiModel, onChangeSharedOrganizations: () => void) => {
  const organizationSharingButton = model.isOwnedByUsersOrganization ? (
    <a onClick={onChangeSharedOrganizations}>
      <TeamOutlined className="icon-margin-right" />
      Manage Access
    </a>
  ) : null;
  if (model.trainingJob == null) {
    return organizationSharingButton;
  }
  const {
    voxelyticsWorkflowHash,
    trainingAnnotations,
    state: trainingJobState,
  } = model.trainingJob;

  return (
    <Col>
      {trainingJobState === "SUCCESS" ? <Row>{organizationSharingButton}</Row> : null}
      {voxelyticsWorkflowHash != null ? (
        /* margin left is needed  as organizationSharingButton is a button with a 16 margin */
        <Row>
          <Link to={`/workflows/${voxelyticsWorkflowHash}`}>
            <FileTextOutlined className="icon-margin-right" />
            Voxelytics Report
          </Link>
        </Row>
      ) : null}
      {trainingAnnotations != null ? (
        <Row>
          <EyeOutlined
            className="icon-margin-right"
            style={{ color: "var(--ant-color-primary)" }}
          />
          {getShowTrainingDataLink(trainingAnnotations)}
        </Row>
      ) : null}
    </Col>
  );
};

function EditModelSharedOrganizationsModal({
  model,
  onClose,
  owningOrganization,
}: { model: AiModel; onClose: () => void; owningOrganization: string }) {
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<string[]>(
    model.sharedOrganizationIds || [owningOrganization],
  );
  const usersOrganizations = useFetch(getUsersOrganizations, [], []);
  const options = usersOrganizations.map((org) => {
    const additionalProps =
      org.id === owningOrganization
        ? { disabled: true, title: "Cannot remove owning organization from model." }
        : {};
    return { label: org.name, value: org.id, ...additionalProps };
  });

  const handleChange = (organizationIds: string[]) => {
    if (!organizationIds.some((id) => id === owningOrganization)) {
      organizationIds.push(owningOrganization);
    }
    setSelectedOrganizationIds(organizationIds);
  };

  const submitNewSharedOrganizations = async () => {
    try {
      const updatedModel = { ...model, sharedOrganizationIds: selectedOrganizationIds };
      await updateAiModel(updatedModel);
      Toast.success(
        `Successfully updated organizations that can access model ${updatedModel.name}.`,
      );
      onClose();
    } catch (e) {
      Toast.error("Failed to update shared organizations. See console for details.");
      console.error("Failed to update shared organizations.", e);
    }
  };

  return (
    <Modal
      title={`Edit Organizations with Access to AI Model ${model.name}`}
      open
      onOk={submitNewSharedOrganizations}
      onCancel={onClose}
      onClose={onClose}
      maskClosable={false}
      width={800}
    >
      <p>
        Select all organization that should have access to the AI model{" "}
        <Typography.Text italic>{model.name}</Typography.Text>.
      </p>
      <Typography.Paragraph type="secondary">
        You can only select or deselect organizations that you are a member of. However, other users
        in your organization may have granted access to additional organizations that you are not
        part of. Only members of your organization who have access to those organizations can modify
        their access.
      </Typography.Paragraph>
      <Col span={14} offset={4}>
        <Select
          mode="multiple"
          allowClear
          autoFocus
          style={{ width: "100%" }}
          placeholder="Please select"
          onChange={handleChange}
          options={options}
          value={selectedOrganizationIds}
        />
      </Col>
    </Modal>
  );
}
