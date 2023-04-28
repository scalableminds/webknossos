import { Table, TableProps } from "antd";
import * as React from "react";
type Props<RecordType extends object = any> = TableProps<RecordType> & {
  children: Array<React.ReactElement<typeof Table.Column> | null>;
};

type State = {
  expandedRows: Array<string>;
  className?: string;
};
/** This is a wrapper for large tables that have fixed columns and support expanded rows.
 *  This wrapper ensures that when rows are expanded no column is fixed as this creates rendering bugs.
 *  If you are using this wrapper, you do not need to set the class "large-table"
 *  and the scroll prop as this is already done by the wrapper.
 */

export default class FixedExpandableTable extends React.PureComponent<Props, State> {
  state: State = {
    expandedRows: [],
  };

  render() {
    const { expandedRows } = this.state;
    const { children, className, ...restProps } = this.props;
    // Don't use React.Children.map here, since this adds .$ prefixes
    // to the keys. However, the keys are needed when managing the sorters
    // of the table.
    const columnsWithAdjustedFixedProp = children
      .filter((el) => el)
      // @ts-ignore The previous filter removes null
      .map((child: React.ReactElement<typeof Table.Column>) => {
        // @ts-ignore
        const columnFixed: boolean = expandedRows.length > 0 ? false : child.props.fixed;
        return React.cloneElement(child, {
          // @ts-ignore
          fixed: columnFixed,
        });
      });
    return (
      <Table
        {...restProps}
        expandedRowKeys={expandedRows}
        scroll={{
          x: "max-content",
        }}
        className={`large-table ${className}`}
        onExpandedRowsChange={(selectedRows: Array<string | number>) => {
          this.setState({
            expandedRows: selectedRows as string[],
          });
        }}
      >
        {columnsWithAdjustedFixedProp}
      </Table>
    );
  }
}
