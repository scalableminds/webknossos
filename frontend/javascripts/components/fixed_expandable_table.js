// @flow
import { Table } from "antd";
import * as React from "react";

type Props = {
  children: Array<React.Element<typeof Table.Column>>,
  expandedRowRender: Function,
};

type State = {
  expandedColumns: Array<string>,
};

/** This is a wrapper for large tables that have fixed columns and support expanded rows.
 *  This wrapper ensures that when columns are expanded no column is fixed as this creates rendering bugs.
 *  If you are using this wrapper, you do not need to set the class "large-table"
 *  and the scroll prop as this is already done by the wrapper.
 */
export default class FixedExpandableTable extends React.PureComponent<Props, State> {
  state = {
    expandedColumns: [],
  };

  render() {
    const { expandedColumns } = this.state;
    const { children, ...restProps } = this.props;

    // Don't use React.Children.map here, since this adds .$ prefixes
    // to the keys. However, the keys are needed when managing the sorters
    // of the table.
    const columnsWithAdjustedFixedProp = children.map(child => {
      const columnFixed = expandedColumns.length > 0 ? false : child.props.fixed;
      return React.cloneElement(child, { fixed: columnFixed });
    });

    return (
      <Table
        {...restProps}
        expandedRowKeys={expandedColumns}
        scroll={{ x: "max-content" }}
        className="large-table"
        onExpandedRowsChange={(selectedRows: Array<string>) => {
          this.setState({
            expandedColumns: selectedRows,
          });
        }}
      >
        {columnsWithAdjustedFixedProp}
      </Table>
    );
  }
}
