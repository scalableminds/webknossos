// @flow
import { Table } from "antd";
import * as React from "react";

type Props = {
  children: React.Node,
  expandedRowRender?: Function,
};

type State = {
  expandedColumns: Array<string>,
  ignoreNextUpdate: boolean,
};

/** This is a wrapper for large tables that have fixed columns and support expanded rows.
 *  This wrapper ensures that when columns are expanded no column is fixed as this creates rendering bugs.
 *  If you are using this wrapper, you do not need to set the class "large-table"
 *  and the scroll prop as this is already done by the wrapper.
 */
export default class LargeTableWrapper extends React.PureComponent<Props, State> {
  state = {
    expandedColumns: [],
    ignoreNextUpdate: false,
  };

  render() {
    const { expandedColumns } = this.state;
    const { children, ...restProps } = this.props;
    const hasExpandableRows = restProps.expandedRowRender != null;
    const columnsWithAdjustedFixedProp = React.Children.map(children, child => {
      const columnFixed = expandedColumns.length > 0 ? false : child.props.fixed;
      return React.cloneElement(child, { fixed: columnFixed });
    });

    return (
      <Table
        {...restProps}
        expandedRowKeys={hasExpandableRows ? expandedColumns : null}
        scroll={{ x: "max-content" }}
        className="large-table"
        onExpandedRowsChange={
          hasExpandableRows
            ? (selectedRows: Array<string>) => {
                if (this.state.ignoreNextUpdate) {
                  this.setState({ ignoreNextUpdate: false });
                  return;
                }
                this.setState(prevState => ({
                  expandedColumns: selectedRows,
                  ignoreNextUpdate:
                    prevState.expandedColumns.length === 0 && selectedRows.length > 0,
                }));
              }
            : () => {}
        }
      >
        {columnsWithAdjustedFixedProp}
      </Table>
    );
  }
}
