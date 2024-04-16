import { Button, Table, TableProps } from "antd";
import { GetRowKey } from "antd/lib/table/interface";
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

  getAllRowIds(
    dataSource: readonly any[] | undefined,
    rowKey: string | number | symbol | GetRowKey<any> | undefined,
  ) {
    const canUseRowKey = typeof rowKey === "string";
    return dataSource != null && canUseRowKey ? dataSource.map((row) => row[rowKey]) : [];
  }

  componentDidUpdate(prevProps: Readonly<Props<any>>): void {
    if (prevProps.dataSource !== this.props.dataSource) {
      this.setState({ expandedRows: [] })
    }
  }

  render() {
    const { expandedRows } = this.state;
    const { children, className, expandable, ...restProps } = this.props;
    const { dataSource, rowKey } = this.props;
    const areAllRowsExpanded =
      dataSource != null && this.state.expandedRows.length === dataSource?.length;

    const columnTitleCollapsed = (
      <Button
        className="ant-table-row-expand-icon ant-table-row-expand-icon-collapsed"
        title="Expand all rows"
        onClick={() => this.setState({ expandedRows: this.getAllRowIds(dataSource, rowKey) })}
      />
    );
    const columnTitleExpanded = (
      <Button
        className="ant-table-row-expand-icon ant-table-row-expand-icon-expanded"
        title="Collapse all rows"
        onClick={() => this.setState({ expandedRows: [] })}
      />
    );
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
    const expandableProp = {
      ...expandable,
      expandedRowKeys: expandedRows,
      onExpandedRowsChange: (selectedRows: readonly React.Key[]) => {
        this.setState({
          expandedRows: selectedRows as string[],
        });
      },
      columnTitle: areAllRowsExpanded ? columnTitleExpanded : columnTitleCollapsed,
    };
    return (
      <Table
        {...restProps}
        expandable={expandableProp}
        scroll={{
          x: "max-content",
        }}
        className={`large-table ${className}`}
      >
        {columnsWithAdjustedFixedProp}
      </Table>
    );
  }
}
