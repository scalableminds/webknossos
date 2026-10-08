import {
  CheckOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import {
  getAlignmentProject,
  getAlignmentProjectJobs,
  updateAlignmentProject,
} from "admin/api/alignment_projects";
import { cancelJob } from "admin/api/jobs";
import { JobState } from "admin/job/job_list_view";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Result,
  Select,
  Space,
  Spin,
  Table,
  Tag,
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
import type { APIJob } from "types/api_types";
import { AllUnits, LongUnitToShortUnitMap, type UnitLong, type Vector3 } from "viewer/constants";
import { formatSectionRange } from "./alignment_project_utils";
import {
  type AlignmentProjectDeletionMode,
  DeleteAlignmentProjectModal,
} from "./delete_alignment_project_modal";
import { StartAlignmentProjectModal } from "./start_alignment_project_modal";

const { Column } = Table;
const JOB_REFRESH_INTERVAL = 5000;

function AlignmentProjectDetailView() {
  const { alignmentProjectId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { modal } = App.useApp();
  const [isStartModalOpen, setIsStartModalOpen] = useState(false);
  // Non-null while the voxel size is being edited.
  const [voxelSizeDraft, setVoxelSizeDraft] = useState<{
    factor: Vector3;
    unit: UnitLong;
  } | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const isCurrentUserSuperUser = useWkSelector((state) => state.activeUser?.isSuperUser);

  const queryKey = ["alignmentProjects", alignmentProjectId];
  const jobsQueryKey = ["alignmentProjects", alignmentProjectId, "jobs"];
  const {
    data: project,
    isLoading,
    isError,
  } = useQuery({
    queryKey,
    queryFn: () => getAlignmentProject(alignmentProjectId),
    retry: false,
  });
  const { data: jobs, isLoading: areJobsLoading } = useQuery({
    queryKey: jobsQueryKey,
    queryFn: () => getAlignmentProjectJobs(alignmentProjectId),
    refetchInterval: JOB_REFRESH_INTERVAL,
    enabled: project != null,
  });

  if (isError) {
    return <Result status="404" title="Alignment project not found." />;
  }
  if (isLoading || project == null) {
    return <Spin spinning size="large" style={{ width: "100%", marginTop: 100 }} />;
  }

  const handleUpdate = async (update: Parameters<typeof updateAlignmentProject>[1]) => {
    try {
      await updateAlignmentProject(project.id, update);
    } catch (_error) {
      // The request library already shows the error, e.g. for a duplicate name.
    }
    await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
  };

  const saveVoxelSizeDraft = () => {
    if (voxelSizeDraft == null) return;
    if (voxelSizeDraft.factor.some((el) => !(el > 0))) {
      Toast.error("Each component of the voxel size must be larger than 0.");
      return;
    }
    handleUpdate({ voxelSize: voxelSizeDraft });
    setVoxelSizeDraft(null);
  };

  const startDisabledReason =
    project.status === "UPLOADING"
      ? "The upload of this project has not finished yet."
      : project.status === "INVALID"
        ? "The uploaded CSV could not be parsed."
        : project.isInputDataDeleted
          ? "The input data of this project was deleted. Please create a new alignment project to start another alignment."
          : null;

  const handleDeleted = async (mode: AlignmentProjectDeletionMode) => {
    if (mode === "project") {
      navigate("/alignmentProjects");
      queryClient.removeQueries({ queryKey });
    }
    await queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] });
  };

  const renderActions = (job: APIJob) => {
    if (job.state === "PENDING" || job.state === "STARTED") {
      return (
        <AsyncLink
          onClick={async () => {
            const isCancelConfirmed = await modal.confirm({
              title: <p>Are you sure you want to cancel job {job.id}?</p>,
              okText: "Yes, cancel job",
              cancelText: "No, keep it",
            });
            if (isCancelConfirmed) {
              await cancelJob(job.id);
              await queryClient.invalidateQueries({ queryKey: jobsQueryKey });
            }
          }}
          icon={<CloseCircleOutlined className="icon-margin-right" />}
        >
          Cancel
        </AsyncLink>
      );
    }
    if (job.state === "SUCCESS" && job.resultLink != null) {
      return (
        <Link to={job.resultLink}>
          <LinkButton icon={<EyeOutlined />}>View</LinkButton>
        </Link>
      );
    }
    if (job.state === "FAILURE" && job.errorDetails != null) {
      const message =
        job.errorDetails.message != null ? (
          <p>{job.errorDetails.message as string}</p>
        ) : (
          <pre style={{ maxHeight: 400, overflow: "auto" }}>
            {JSON.stringify(job.errorDetails, null, 2)}
          </pre>
        );
      return (
        <a
          onClick={() => modal.error({ title: "Job Error Details", width: 600, content: message })}
        >
          <WarningOutlined className="icon-margin-right" />
          Show Error
        </a>
      );
    }
    return null;
  };

  const renderSectionRange = (job: APIJob) => {
    const sectionRange = job.args.sectionRange;
    if (sectionRange != null) {
      return formatSectionRange({ first: sectionRange[0], last: sectionRange[1] });
    }
    // null means all sections of the project.
    return project.sectionRange != null ? formatSectionRange(project.sectionRange) : "All";
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
          <Tooltip title={startDisabledReason}>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={startDisabledReason != null}
              onClick={() => setIsStartModalOpen(true)}
            >
              Start Alignment
            </Button>
          </Tooltip>
        </Space>
      }
    >
      <Card title="Uploaded Files">
        {project.status === "UPLOADING" && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title="The upload of this project has not finished yet."
          />
        )}
        {project.status === "INVALID" && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16 }}
            title="The uploaded CSV is invalid. Please create a new alignment project with a corrected CSV."
            description={project.invalidReason}
          />
        )}
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
            {project.csvPath != null ? (
              <Space size={4}>
                <FileTextOutlined />
                <Typography.Text code>{project.csvPath}</Typography.Text>
              </Space>
            ) : (
              "-"
            )}
          </Descriptions.Item>
          <Descriptions.Item label="Uploaded Files">
            {project.fileCount != null ? project.fileCount.toLocaleString() : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Sections">
            {project.sectionRange != null ? formatSectionRange(project.sectionRange) : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Total Size">
            {project.totalSizeInBytes != null ? formatBytes(project.totalSizeInBytes, 1) : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Voxel Size">
            {voxelSizeDraft != null ? (
              <Space size={4}>
                <Vector3Input
                  size="small"
                  allowDecimals
                  autoFocus
                  value={voxelSizeDraft.factor}
                  onChange={(factor) => setVoxelSizeDraft({ ...voxelSizeDraft, factor })}
                  onPressEnter={saveVoxelSizeDraft}
                />
                <Select
                  size="small"
                  value={voxelSizeDraft.unit}
                  onChange={(unit) => setVoxelSizeDraft({ ...voxelSizeDraft, unit })}
                  popupMatchSelectWidth={false}
                  options={AllUnits.map((unit) => ({
                    value: unit,
                    label: LongUnitToShortUnitMap[unit],
                  }))}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<CheckOutlined />}
                  onClick={saveVoxelSizeDraft}
                />
                <Button
                  size="small"
                  type="text"
                  icon={<CloseOutlined />}
                  onClick={() => setVoxelSizeDraft(null)}
                />
              </Space>
            ) : (
              <Space size={4}>
                {project.voxelSize.factor.join(" × ")}{" "}
                {LongUnitToShortUnitMap[project.voxelSize.unit]}
                <Typography.Link onClick={() => setVoxelSizeDraft(project.voxelSize)}>
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
          dataSource={jobs ?? []}
          loading={areJobsLoading}
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
          <Column title="Sections" key="sectionRange" render={renderSectionRange} />
          <Column
            title="Output Dataset"
            key="outputDataset"
            render={(job: APIJob) => (
              <Space size={4}>
                {job.resultLink != null ? (
                  <Link to={job.resultLink}>{job.args.newDatasetName}</Link>
                ) : (
                  (job.args.newDatasetName ?? "-")
                )}
                {job.args.renderUnaligned && <Tag>Unaligned</Tag>}
              </Space>
            )}
          />
          <Column
            title="Owner"
            key="owner"
            render={(job: APIJob) => (
              <>
                <div>{`${job.ownerLastName}, ${job.ownerFirstName}`}</div>
                <div>{`(${job.ownerEmail})`}</div>
              </>
            )}
          />
          <Column
            title="Cost in Credits"
            key="costInMilliCredits"
            align="right"
            render={(job: APIJob) =>
              job.costInMilliCredits ? formatMilliCreditsString(job.costInMilliCredits) : "-"
            }
          />
          <Column
            title="Date"
            key="created"
            width={190}
            sorter={compareBy<APIJob>((job) => job.created)}
            defaultSortOrder="descend"
            render={(job: APIJob) => <FormattedDate timestamp={job.created} />}
          />
          {isCurrentUserSuperUser ? (
            <Column
              title="Voxelytics"
              key="workflow"
              width={150}
              render={(job: APIJob) =>
                job.voxelyticsWorkflowHash != null ? (
                  <Link to={`/workflows/${job.voxelyticsWorkflowHash}`}>Workflow</Link>
                ) : null
              }
            />
          ) : null}
          <Column
            title="State"
            key="state"
            width={120}
            render={(job: APIJob) => <JobState job={job} />}
          />
          <Column title="Action" key="actions" width={150} render={renderActions} />
        </Table>
      </Card>

      {isDeleteModalOpen && (
        <DeleteAlignmentProjectModal
          project={project}
          hasActiveJobs={(jobs ?? []).some(
            (job) => job.state === "PENDING" || job.state === "STARTED",
          )}
          isOpen
          onClose={() => setIsDeleteModalOpen(false)}
          onDeleted={handleDeleted}
        />
      )}
      {project.sectionRange != null && (
        <StartAlignmentProjectModal
          project={project}
          sectionRange={project.sectionRange}
          isOpen={isStartModalOpen}
          onClose={() => setIsStartModalOpen(false)}
          onStarted={() => queryClient.invalidateQueries({ queryKey: ["alignmentProjects"] })}
        />
      )}
    </AdminPage>
  );
}

export default AlignmentProjectDetailView;
