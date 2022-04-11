import { Table } from "antd";
import * as React from "react";
type Props = {
  children: Array<React.ReactElement<typeof Table.Column>>;
  expandedRowRender: (...args: Array<any>) => any;
};
type State = {
  expandedColumns: Array<string>;
};
/** This is a wrapper for large tables that have fixed columns and support expanded rows.
 *  This wrapper ensures that when columns are expanded no column is fixed as this creates rendering bugs.
 *  If you are using this wrapper, you do not need to set the class "large-table"
 *  and the scroll prop as this is already done by the wrapper.
 */

export default class FixedExpandableTable extends React.PureComponent<Props, State> {
  state: State = {
    expandedColumns: [],
  };

  render() {
    const { expandedColumns } = this.state;
    const { children, ...restProps } = this.props;
    // Don't use React.Children.map here, since this adds .$ prefixes
    // to the keys. However, the keys are needed when managing the sorters
    // of the table.
    const columnsWithAdjustedFixedProp = children.map((child) => {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'fixed' does not exist on type '<RecordTy... Remove this comment to see the full error message
      const columnFixed = expandedColumns.length > 0 ? false : child.props.fixed;
      return React.cloneElement(child, {
        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
        fixed: columnFixed,
      });
    });
    return (
      <Table
        {...restProps}
        expandedRowKeys={expandedColumns}
        scroll={{
          x: "max-content",
        }}
        className="large-table"
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(selectedRows: Array<string>) => void' is no... Remove this comment to see the full error message
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
