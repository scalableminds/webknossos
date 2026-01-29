import {
  FileTextOutlined,
  InfoCircleOutlined,
  SyncOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getUsersOrganizations } from "admin/api/organization";
import { getShowTrainingDataLink, JobState } from "admin/job/job_list_view";
import { getAiModels, updateAiModel } from "admin/rest_api";
import { App, Button, Col, Flex, Modal, Row, Select, Table, Tooltip, Typography } from "antd";
import FormattedDate from "components/formatted_date";
import LinkButton from "components/link_button";
import { useFetch } from "libs/react_helpers";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import uniq from "lodash-es/uniq";
import type { Key } from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { AiModel } from "types/api_types";
import { enforceActiveUser, formatUserName } from "viewer/model/accessors/user_accessor";

export default function AiModelListView() {
  const activeUser = useWkSelector((state) => enforceActiveUser(state.activeUser));
  const [currentlyEditedModel, setCurrentlyEditedModel] = useState<AiModel | null>(null);
  const { modal } = App.useApp();

  const {
    data: aiModels = [],
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["aiModels"],
    queryFn: async () => {
      try {
        return await getAiModels();
      } catch (err) {
        Toast.error("Could not load model list.");
        console.error(err);
        throw err;
      }
    },
  });

  return (
    <div className="container voxelytics-view">
      {currentlyEditedModel ? (
        <EditModelSharedOrganizationsModal
          model={currentlyEditedModel}
          onClose={() => {
            setCurrentlyEditedModel(null);
            refetch();
          }}
          owningOrganization={activeUser.organization}
        />
      ) : null}
      <Flex justify="space-between" align="flex-start">
        <h3>AI Models</h3>
        <Button onClick={() => refetch()}>
          <SyncOutlined spin={isFetching} /> Refresh
        </Button>
      </Flex>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 20 }}>
        This list shows all AI models available in your organization. You can use these models to
        run AI segmentation jobs on your datasets.
        <a
          href="https://docs.webknossos.org/webknossos/automation/ai_segmentation.html"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Tooltip title="Read more in the documentation">
            <InfoCircleOutlined className="icon-margin-left" />
          </Tooltip>
        </a>
        <br />
        Model training functionality is coming soon.
      </Typography.Paragraph>

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
            filters: uniq(aiModels.map((model) => formatUserName(null, model.user))).map(
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
              renderActionsForModel(modal, aiModel, () => setCurrentlyEditedModel(aiModel)),
            key: "actions",
          },
        ]}
        dataSource={aiModels}
      />
    </div>
  );
}

const renderActionsForModel = (
  modal: ReturnType<typeof App.useApp>["modal"],
  model: AiModel,
  onChangeSharedOrganizations: () => void,
) => {
  const organizationSharingButton = model.isOwnedByUsersOrganization ? (
    <LinkButton onClick={onChangeSharedOrganizations} icon={<TeamOutlined />}>
      Manage Access
    </LinkButton>
  ) : null;
  if (model.trainingJob == null) {
    return organizationSharingButton;
  }
  const { voxelyticsWorkflowHash, state: trainingJobState } = model.trainingJob;
  const trainingAnnotations = model.trainingJob.args.trainingAnnotations;

  return (
    <Col>
      {trainingJobState === "SUCCESS" ? <Row>{organizationSharingButton}</Row> : null}
      {voxelyticsWorkflowHash != null ? (
        <Row>
          <Link to={`/workflows/${voxelyticsWorkflowHash}`}>
            <LinkButton icon={<FileTextOutlined />}>Voxelytics Report</LinkButton>
          </Link>
        </Row>
      ) : null}
      {trainingAnnotations != null ? (
        <Row>{getShowTrainingDataLink(modal, trainingAnnotations)}</Row>
      ) : null}
    </Col>
  );
};

function EditModelSharedOrganizationsModal({
  model,
  onClose,
  owningOrganization,
}: {
  model: AiModel;
  onClose: () => void;
  owningOrganization: string;
}) {
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
      title={"Edit Organizations with Access to this AI Model"}
      open
      onOk={submitNewSharedOrganizations}
      onCancel={onClose}
      maskClosable={false}
      width={800}
    >
      <p>
        Select all organizations that should have access to the AI model{" "}
        <Typography.Text italic>{model.name}</Typography.Text>.
      </p>
      <Typography.Paragraph type="secondary">
        You can only manage access for organizations you belong to. Other members of your
        organization may have access to additional organizations not listed here. Only they can
        modify access for those organizations.
      </Typography.Paragraph>
      <Flex justify="center">
        <Select
          mode="multiple"
          allowClear
          autoFocus
          style={{ minWidth: 400 }}
          dropdownMatchSelectWidth={false}
          placeholder="Please select"
          onChange={handleChange}
          options={options}
          value={selectedOrganizationIds}
        />
      </Flex>
    </Modal>
  );
}
