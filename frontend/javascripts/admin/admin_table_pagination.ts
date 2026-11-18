import type { TablePaginationConfig } from "antd";
import { scrollToTop } from "libs/utils";

/**
 * Pagination for the admin list tables, which shows how many entries match the current filters.
 * Pass `isTruncated` if the server may have omitted entries, so that the total is a lower bound.
 */
export function getAdminTablePagination({
  isTruncated = false,
}: {
  isTruncated?: boolean;
} = {}): TablePaginationConfig {
  return {
    defaultPageSize: 50,
    onChange: scrollToTop,
    showTotal: (total, [from, to]) => `${from}–${to} of ${total}${isTruncated ? "+" : ""}`,
  };
}
