# Segment Statistics
WEBKNOSSOS provides handy statistics about your labelled segments, such as the volume and bounding box of a segment.

There are several ways to access this information: 

1. Right-click any segment to bring up the context menu. The segment statistics are listed at the end of the context menu.
2. In the [`Segments`](./segments_list.md) tab in the right-hand panel, right-click on any group of segments (or the "Root" group) to bring up a context menu. Select `Show Segment Statistics` to open the `Statistics` tab with a table of statistics for the whole group of labelled segments. The same entry is available for single segments and for a selection of segments. These can be exported as CSV files for further analysis outside of WEBKNOSSOS.

While the `Statistics` tab is shown, WEBKNOSSOS makes room for the table: the right-hand panel is widened and the viewports are stacked in one column (the XY, YZ and XZ viewports become tabs above the 3D viewport). On smaller screens, the left-hand panel is closed as well. On very wide screens (2500 pixels and more), only the right-hand panel is widened and the viewports stay as they are. Your previous layout is restored as soon as you switch to another tab or close the `Statistics` tab. The `Statistics` tab is not kept when the page is reloaded or another dataset is opened; open it again from the context menu. For more than 50 segments, the statistics are only computed after clicking `Compute statistics`.

The `Statistics` tab offers several ways to explore the numbers:

- **Sorting and units:** Click a column header to sort by it. All values of a column share one unit, which is shown below the column title. A thin bar below each number relates it to the other segments.
- **Grouping:** If your segments are organized in groups, the table is nested along these groups. Each group row shows aggregated values for all of its segments, e.g. the total volume. Use `Group by` to switch to a flat list.
- **Stats & filters:** The rail on the left has a card for every statistic. There you can hide its column, switch its unit, see the distribution of its values and restrict the table to a value range. The export contains the filtered rows and the visible columns.
- **Compare:** Tick up to six segments or groups in the table and switch to `Compare` to see their statistics side by side, together with their position within the distribution of all segments.
- **Navigation:** Click a row to select the segment and jump to it. Click a position (e.g. of a bounding box) to jump there.
- **Sharing:** The link button copies a link that reopens the statistics exactly as they are shown, including filters, sorting and the comparison.

In cases where you only wish to measure a simple distance or surface area, use the [`Measurement Tool`](../ui/toolbar.md#measurement-and-analysis) instead.

![youtube-video](https://www.youtube.com/embed/PsvC4vNyxJM)
