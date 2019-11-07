// @flow
import { Link, type RouterHistory, withRouter } from "react-router-dom";
import { Spin, Table, Tag, Icon, Popover, Tooltip, Row, Col } from "antd";
import Markdown from "react-remarkable";
import * as React from "react";
import type { APIAnnotationCompact } from "admin/api_flow_types";
import FormattedDate from "components/formatted_date";
import { getSharedAnnotations } from "admin/admin_rest_api";
import { formatHash, stringToColor } from "libs/format_utils";
import { handleGenericError } from "libs/error_handling";
import * as Utils from "libs/utils";
import Persistence from "libs/persistence";

const { Column } = Table;

const typeHint: APIAnnotationCompact[] = [];

type Props = { history: RouterHistory };

type State = { annotations: Array<APIAnnotationCompact>, isLoading: boolean };

const persistence: Persistence<State> = new Persistence({}, "sharedList");

class SharedAnnotationsView extends React.PureComponent<Props, State> {
  state = {
    annotations: [],
    isLoading: false,
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount = () => {
    this.fetchData();
  };

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
  }

  fetchData = async () => {
    try {
      this.setState({ isLoading: true });
      const annotations = await getSharedAnnotations();
      this.setState({ annotations });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  };

  renderNameWithDescription(tracing: APIAnnotationCompact) {
    const hasDescription = tracing.description !== "";
    const markdownDescription = (
      <div style={{ maxWidth: 400 }}>
        <Markdown
          source={tracing.description}
          options={{ html: false, breaks: true, linkify: true }}
        />
      </div>
    );
    return (
      <React.Fragment>
        <span style={{ margin: "0 10px", display: "inline-block" }}>{tracing.name}</span>
        {hasDescription ? (
          <Tooltip title="Show description" placement="bottom">
            <Popover title="Description" trigger="click" content={markdownDescription}>
              <i className="fa fa-align-justify" style={{ cursor: "pointer" }} />
            </Popover>
          </Tooltip>
        ) : null}
      </React.Fragment>
    );
  }

  renderPlaceholder = () =>
    this.state.isLoading ? null : (
      <Row type="flex" justify="center" style={{ padding: "20px 50px 70px" }} align="middle">
        <Col span={18}>
          <div style={{ paddingBottom: 32, textAlign: "center" }}>
            There are no shared annotations available yet. You can share your annotations with
            selected teams in the sharing modal in the tracing view. These annotations appear in the
            shared tab of all members of these teams.
          </div>
        </Col>
      </Row>
    );

  renderTable = () => {
    const sortedAnnotations = this.state.annotations.sort(
      Utils.compareBy(typeHint, annotation => annotation.modified, false),
    );

    return (
      <Table
        dataSource={sortedAnnotations}
        rowKey="id"
        pagination={{
          defaultPageSize: 50,
        }}
        className="large-table"
        scroll={{ x: "max-content" }}
      >
        <Column
          title="ID"
          dataIndex="id"
          width={100}
          render={(__, tracing: APIAnnotationCompact) => formatHash(tracing.id)}
          sorter={Utils.localeCompareBy(typeHint, annotation => annotation.id)}
          className="monospace-id"
        />
        <Column
          title="Name"
          width={280}
          dataIndex="name"
          sorter={Utils.localeCompareBy(typeHint, annotation => annotation.name)}
          render={(name: string, tracing: APIAnnotationCompact) =>
            this.renderNameWithDescription(tracing)
          }
        />
        <Column
          title="Creator"
          width={280}
          dataIndex="owner"
          sorter={Utils.localeCompareBy(typeHint, annotation =>
            annotation.owner ? annotation.owner : "",
          )}
          render={(name: string, tracing: APIAnnotationCompact) =>
            tracing.owner ? tracing.owner : ""
          }
        />
        <Column
          title="Tags"
          dataIndex="tags"
          render={(tags: Array<string>) => (
            <div>
              {tags.map(tag => (
                <Tag key={tag} color={stringToColor(tag)}>
                  {tag}
                </Tag>
              ))}
            </div>
          )}
        />
        <Column
          title="Modification Date"
          dataIndex="modified"
          width={200}
          sorter={Utils.compareBy(typeHint, annotation => annotation.modified)}
          render={modified => <FormattedDate timestamp={modified} />}
        />
        <Column
          width={200}
          fixed="right"
          title="Actions"
          className="nowrap"
          key="action"
          render={(__, tracing: APIAnnotationCompact) => {
            const { typ, id } = tracing;
            return (
              <Link to={`/annotations/${typ}/${id}`}>
                <Icon type="eye-o" />
                View
              </Link>
            );
          }}
        />
      </Table>
    );
  };

  render = () => (
    <div className="TestExplorativeAnnotationsView">
      <h3 style={{ display: "inline-block", "margin-right": "10px" }}>Shared Annotations</h3>
      <Tooltip title="This is the Shared Annotations tab. Annotations that are shared with teams you are a member of are displayed here. You can share your own annotations in the sharing modal in the tracing view.">
        <Icon type="info-circle-o" style={{ color: "gray" }} />
      </Tooltip>
      <div className="clearfix" style={{ margin: "20px 0px" }} />
      <Spin spinning={this.state.isLoading} size="large">
        {this.state.annotations.length === 0 ? this.renderPlaceholder() : this.renderTable()}
      </Spin>
    </div>
  );
}

export default withRouter(SharedAnnotationsView);
