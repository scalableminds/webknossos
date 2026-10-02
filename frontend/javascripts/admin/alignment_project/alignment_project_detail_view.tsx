import {
  CloseCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import { JobState } from "admin/job/job_list_view";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Result,
  Space,
  Spin,
  Table,
  Tooltip,
  Typography,
} from "antd";
import { AsyncLink } from "components/async_clickables";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import LinkButton from "components/link_button";
import { formatBytes, formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { compareBy } from "libs/utils";
import { Vector3Input } from "libs/vector_input";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { Vector3 } from "viewer/constants";
import { getViewDatasetURL } from "viewer/model/accessors/dataset_accessor";
import {
  type APIAlignmentProjectRun,
  cancelAlignmentProjectRun,
  getAlignmentProject,
  updateAlignmentProject,
} from "./alignment_project_mock_data";
import {
  type AlignmentProjectDeletionMode,
  DeleteAlignmentProjectModal,
} from "./delete_alignment_project_modal";
import { StartAlignmentProjectModal } from "./start_alignment_project_modal";

const { Column } = Table;

function AlignmentProjectDetailView() {
  const { alignmentProjectId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  const [isEditingVoxelSize, setIsEditingVoxelSize] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  const queryKey = ["alignmentProjects", alignmentProjectId];
  const {
    data: project,
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => getAlignmentProject(alignmentProjectId),
    retry: false,
  });

  if (isError) {
    return <Result status="404" title="Alignment project not found." />;
  }
  if (isLoading || project == null) {
    return <Spin spinning size="large" style={{ width: "100%", marginTop: 100 }} />;
  }

  const handleUpdate = async (update: Parameters<typeof updateAlignmentProject>[1]) => {
    await updateAlignmentProject(project.id, update);
    await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
  };

  // Called on blur (also triggered by pressing enter).
  const handleVoxelSizeChange = (voxelSize: Vector3) => {
    setIsEditingVoxelSize(false);
    if (voxelSize.some((el) => !(el > 0))) {
      Toast.error("Each component of the voxel size must be larger than 0.");
      return;
    }
    handleUpdate({ voxelSize });
  };

  const handleDeleted = async (mode: AlignmentProjectDeletionMode) => {
    if (mode === "project") {
      navigate("/alignmentProjects");
      queryClient.removeQueries({ queryKey });
    }
    await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
  };

  const renderActions = (run: APIAlignmentProjectRun) => {
    if (run.state === "PENDING" || run.state === "STARTED") {
      return (
        <AsyncLink
          onClick={async () => {
            const isCancelConfirmed = await modal.confirm({
              title: <p>Are you sure you want to cancel job {run.id}?</p>,
              okText: "Yes, cancel job",
              cancelText: "No, keep it",
            });
            if (isCancelConfirmed) {
              await cancelAlignmentProjectRun(project.id, run.id);
              await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
            }
          }}
          icon={<CloseCircleOutlined className="icon-margin-right" />}
        >
          Cancel
        </AsyncLink>
      );
    }
    if (run.state === "SUCCESS" && run.outputDataset != null) {
      return (
        <Link to={getViewDatasetURL(run.outputDataset)}>
          <LinkButton icon={<EyeOutlined />}>View</LinkButton>
        </Link>
      );
    }
    if (run.state === "FAILURE" && run.errorMessage != null) {
      return (
        <a
          onClick={() =>
            modal.error({ title: "Job Error Details", width: 600, content: run.errorMessage })
          }
        >
          <WarningOutlined className="icon-margin-right" />
          Show Error
        </a>
      );
    }
    return null;
  };

  return (
    <AdminPage
      title={
        <Typography.Text
          editable={{
            onChange: (name) => name.trim() !== "" && handleUpdate({ name: name.trim() }),
          }}
          style={{ font: "inherit", textTransform: "inherit" }}
        >
          {project.name}
        </Typography.Text>
      }
      description={
        <Typography.Text
          type="secondary"
          editable={{
            onChange: (description) => handleUpdate({ description }),
            text: project.description,
          }}
        >
          {project.description || <i>No description.</i>}
        </Typography.Text>
      }
      actions={
        <Space>
          <Button danger icon={<DeleteOutlined />} onClick={() => setIsDeleteModalOpen(true)}>
            Delete
          </Button>
          <Tooltip
            title={
              project.isInputDataDeleted
                ? "The input data of this project was deleted. Please create a new alignment project to start another alignment."
                : null
            }
          >
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={project.isInputDataDeleted}
              onClick={() => setIsStartModalOpen(true)}
            >
              Start Alignment
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Card title="Uploaded Files">
        {project.isInputDataDeleted && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="The uploaded files were deleted to free storage. The information below describes the original upload."
          />
        )}
        <Descriptions column={{ xs: 1, md: 2, xl: 3 }}>
          <Descriptions.Item label="Tile CSV">
            <Space size={4}>
              <FileTextOutlined />
              <Typography.Text code>{project.csvFileName}</Typography.Text>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="Uploaded Files">
            {project.fileCount.toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="Total Size">
            {formatBytes(project.totalSizeInBytes, 1)}
          </Descriptions.Item>
          <Descriptions.Item label="Voxel Size">
            {isEditingVoxelSize ? (
              <Vector3Input
                size="small"
                allowDecimals
                autoFocus
                changeOnlyOnBlur
                value={project.voxelSize}
                onChange={handleVoxelSizeChange}
                onPressEnter={(event) => event.currentTarget.blur()}
              />
            ) : (
              <Space size={4}>
                {project.voxelSize.join(" × ")} nm
                <Typography.Link onClick={() => setIsEditingVoxelSize(true)}>
                  <EditOutlined />
                </Typography.Link>
              </Space>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Datastore">{project.dataStoreName}</Descriptions.Item>
          <Descriptions.Item label="Owner">
            {project.ownerFirstName} {project.ownerLastName}
          </Descriptions.Item>
          <Descriptions.Item label="Created">
            <FormattedDate timestamp={project.created} />
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="Alignments">
        <Table
          dataSource={project.runs}
          rowKey="id"
          pagination={false}
          locale={{ emptyText: "No alignments have been run for this project yet." }}
        >
          <Column
            title="Job Id"
            dataIndex="id"
            key="id"
            width={120}
            render={(id) => <FormattedId id={id} />}
          />
          <Column
            title="Output Dataset"
            key="outputDataset"
            render={(run: APIAlignmentProjectRun) =>
              run.outputDataset != null ? (
                <Link to={getViewDatasetURL(run.outputDataset)}>{run.outputDataset.name}</Link>
              ) : (
                "-"
              )
            }
          />
          <Column
            title="Owner"
            key="owner"
            render={(run: APIAlignmentProjectRun) => (
              <>
                <div>{`${run.ownerLastName}, ${run.ownerFirstName}`}</div>
                <div>{`(${run.ownerEmail})`}</div>
              </>
            )}
          />
          <Column
            title="Cost in Credits"
            key="costInMilliCredits"
            align="right"
            render={(run: APIAlignmentProjectRun) =>
              run.costInMilliCredits ? formatMilliCreditsString(run.costInMilliCredits) : "-"
            }
          />
          <Column
            title="Date"
            key="created"
            width={190}
            sorter={compareBy<APIAlignmentProjectRun>((run) => run.created)}
            defaultSortOrder="descend"
            render={(run: APIAlignmentProjectRun) => <FormattedDate timestamp={run.created} />}
          />
          {isCurrentUserSuperUser ? (
            <Column
              title="Voxelytics"
              key="workflow"
              width={150}
              render={(run: APIAlignmentProjectRun) =>
                run.voxelyticsWorkflowHash != null ? (
                  <Link to={`/workflows/${run.voxelyticsWorkflowHash}`}>Workflow</Link>
                ) : null
              }
            />
          ) : null}
          <Column
            title="State"
            key="state"
            width={120}
            render={(run: APIAlignmentProjectRun) => <JobState job={run} />}
          />
          <Column title="Action" key="actions" width={150} render={renderActions} />
        </Table>
      </Card>

      {isDeleteModalOpen && (
        <DeleteAlignmentProjectModal
          project={project}
          isOpen
          onClose={() => setIsDeleteModalOpen(false)}
          onDeleted={handleDeleted}
        />
      )}
      <StartAlignmentProjectModal
        project={project}
        isOpen={isStartModalOpen}
        onClose={() => setIsStartModalOpen(false)}
        onStarted={() => queryClient.invalidateQueries({ queryKey })}
      />
    </AdminPage>
  );
}

export default AlignmentProjectDetailView;
