import { PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import { type APIAlignmentProject, getAlignmentProjects } from "admin/api/alignment_projects";
import { Button, Input, Space, Spin, Table, Tag } from "antd";
import FormattedDate from "components/formatted_date";
import { formatBytes } from "libs/format_utils";
import { compareBy, filterWithSearchQueryAND, localeCompareBy } from "libs/utils";
import { useState } from "react";
import { Link } from "react-router";

const { Column } = Table;

function AlignmentProjectListView() {
  const { data: projects, isLoading } = useQuery({
    queryKey: ["alignmentProjects"],
    queryFn: getAlignmentProjects,
  });
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <AdminPage
      title="Alignment Projects"
      description="Alignment projects hold uploaded (tiled) image data that can be aligned and stitched into new datasets."
      search={
        <Input.Search
          allowClear
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      }
      actions={
        <Link to="/datasets/upload#alignmentProject">
          <Button type="primary" icon={<PlusOutlined />}>
            New Alignment Project
          </Button>
        </Link>
      }
    >
      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={filterWithSearchQueryAND(
            projects || [],
            ["name", "description", "csvPath"],
            searchQuery,
          )}
          rowKey="id"
          pagination={{ defaultPageSize: 50 }}
        >
          <Column
            title="Name"
            key="name"
            sorter={localeCompareBy<APIAlignmentProject>((p) => p.name)}
            render={(project: APIAlignmentProject) => (
              <Space size={4}>
                <Link to={`/alignmentProjects/${project.id}`}>{project.name}</Link>
                {project.status === "UPLOADING" && <Tag color="processing">Uploading</Tag>}
              </Space>
            )}
          />
          <Column
            title="Files"
            key="files"
            align="right"
            sorter={compareBy<APIAlignmentProject>((p) => p.fileCount ?? 0)}
            render={(project: APIAlignmentProject) =>
              project.fileCount != null && project.totalSizeInBytes != null
                ? `${project.fileCount.toLocaleString()} (${formatBytes(project.totalSizeInBytes, 1)})`
                : "-"
            }
          />
          <Column
            title="Alignments"
            key="jobCount"
            align="right"
            sorter={compareBy<APIAlignmentProject>((p) => p.jobCount)}
            render={(project: APIAlignmentProject) => project.jobCount}
          />
          <Column
            title="Owner"
            key="owner"
            render={(project: APIAlignmentProject) =>
              `${project.ownerLastName}, ${project.ownerFirstName}`
            }
          />
          <Column
            title="Created"
            key="created"
            width={190}
            sorter={compareBy<APIAlignmentProject>((p) => p.created)}
            defaultSortOrder="descend"
            render={(project: APIAlignmentProject) => <FormattedDate timestamp={project.created} />}
          />
        </Table>
      </Spin>
    </AdminPage>
  );
}

export default AlignmentProjectListView;
