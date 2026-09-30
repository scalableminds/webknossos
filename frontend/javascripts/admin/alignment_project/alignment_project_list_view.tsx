import { PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import AdminPage from "admin/admin_page";
import { Button, Input, Spin, Table } from "antd";
import FormattedDate from "components/formatted_date";
import { formatBytes } from "libs/format_utils";
import { compareBy, filterWithSearchQueryAND, localeCompareBy } from "libs/utils";
import { useState } from "react";
import { Link } from "react-router";
import { type APIAlignmentProject, getAlignmentProjects } from "./alignment_project_mock_data";

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
            ["name", "description", "csvFileName"],
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
              <Link to={`/alignmentProjects/${project.id}`}>{project.name}</Link>
            )}
          />
          <Column
            title="Files"
            key="files"
            align="right"
            sorter={compareBy<APIAlignmentProject>((p) => p.fileCount)}
            render={(project: APIAlignmentProject) =>
              `${project.fileCount.toLocaleString()} (${formatBytes(project.totalSizeInBytes, 1)})`
            }
          />
          <Column
            title="Alignments"
            key="runs"
            align="right"
            sorter={compareBy<APIAlignmentProject>((p) => p.runs.length)}
            render={(project: APIAlignmentProject) => project.runs.length}
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
