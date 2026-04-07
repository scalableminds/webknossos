import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { PropTypes } from "@scalableminds/prop-types";
import AdminPage from "admin/admin_page";
import { deleteScript as deleteScriptAPI, getScripts } from "admin/rest_api";
import { App, Button, Input, Space, Spin, Table } from "antd";
import FormattedId from "components/formatted_id";
import LinkButton from "components/link_button";
import { handleGenericError } from "libs/error_handling";
import Persistence from "libs/persistence";
import { filterWithSearchQueryAND, localeCompareBy } from "libs/utils";
import partial from "lodash-es/partial";
import messages from "messages";
import type React from "react";
import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { APIScript, APIUser } from "types/api_types";

const { Column } = Table;
const { Search } = Input;

const persistence = new Persistence<{ searchQuery: string }>(
  {
    searchQuery: PropTypes.string,
  },
  "scriptList",
);

function ScriptListView() {
  const { modal } = App.useApp();

  const [isLoading, setIsLoading] = useState(true);
  const [scripts, setScripts] = useState<APIScript[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const { searchQuery } = persistence.load();
    setSearchQuery(searchQuery || "");
    fetchData();
  }, []);

  useEffect(() => {
    persistence.persist({ searchQuery });
  }, [searchQuery]);

  async function fetchData(): Promise<void> {
    const scripts = await getScripts();
    setIsLoading(false);
    setScripts(scripts);
  }

  function handleSearch(event: React.ChangeEvent<HTMLInputElement>): void {
    setSearchQuery(event.target.value);
  }

  function deleteScript(script: APIScript) {
    modal.confirm({
      title: messages["script.delete"],
      onOk: async () => {
        try {
          setIsLoading(true);
          await deleteScriptAPI(script.id);
          setScripts(scripts.filter((s) => s.id !== script.id));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          setIsLoading(false);
        }
      },
    });
  }

  function renderPlaceholder() {
    return isLoading ? null : (
      <Fragment>
        {"There are no scripts. You can "}
        <Link to="/scripts/create">add a script</Link>
        {
          " which can be automatically executed in tasks. Scripts can, for example, be used to add custom keyboard shortcuts."
        }
        <br />
        {"See the "}
        <Link to="/assets/docs/frontend-api/index.html" target="_blank">
          Frontend API Documentation
        </Link>
        {" for more information."}
      </Fragment>
    );
  }

  return (
    <AdminPage
      title="Scripts"
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/scripts.html"
      description="Maintain reusable frontend scripts for automated task workflows."
      actions={
        <Link to="/scripts/create">
          <Button icon={<PlusOutlined />} type="primary">
            Add Script
          </Button>
        </Link>
      }
      search={<Search allowClear onChange={handleSearch} value={searchQuery} />}
    >
      <Spin spinning={isLoading} size="large">
        <Table
          dataSource={filterWithSearchQueryAND(
            scripts,
            ["name", "id", "owner", "gist"],
            searchQuery,
          )}
          rowKey="id"
          pagination={{
            defaultPageSize: 50,
          }}
          locale={{
            emptyText: renderPlaceholder(),
          }}
          scroll={{
            x: "max-content",
          }}
          className="large-table"
        >
          <Column
            title="ID"
            dataIndex="id"
            render={(id) => <FormattedId id={id} />}
            key="id"
            sorter={localeCompareBy<APIScript>((script) => script.id)}
            width={150}
          />
          <Column
            title="Name"
            dataIndex="name"
            key="name"
            sorter={localeCompareBy<APIScript>((script) => script.name)}
            width={250}
          />

          <Column
            title="Owner"
            dataIndex="owner"
            key="owner"
            sorter={localeCompareBy<APIScript>((script) => script.owner.lastName)}
            render={(owner: APIUser) => `${owner.firstName} ${owner.lastName}`}
          />
          <Column
            title="Gist URL"
            dataIndex="gist"
            key="gist"
            sorter={localeCompareBy<APIScript>((script) => script.gist)}
            render={(gist: string) => (
              <a href={gist} target="_blank" rel="noopener noreferrer">
                {gist}
              </a>
            )}
          />
          <Column
            title="Action"
            key="actions"
            fixed="right"
            width={180}
            render={(__, script: APIScript) => (
              <Space orientation="vertical" size={0}>
                <Link to={`/scripts/${script.id}/edit`}>
                  <EditOutlined className="icon-margin-right" />
                  Edit
                </Link>
                <LinkButton onClick={partial(deleteScript, script)} icon={<DeleteOutlined />}>
                  Delete
                </LinkButton>
              </Space>
            )}
          />
        </Table>
      </Spin>
    </AdminPage>
  );
}

export default ScriptListView;
