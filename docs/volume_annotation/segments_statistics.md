# Segment Statistics
WEBKNOSSOS provides handy statistics about your labelled segments, such as the volume and bounding box of a segment.

There are several ways to access this information: 

1. Right-click any segment to bring up the context menu. The segment statistics are listed at the end of the context menu.
2. In the [`Segments`](./segments_list.md) tab in the right-hand panel, right-click on any group of segments (or the "Root" group) to bring up a context menu. Select `Show Segment Statistics` to open the `Statistics` tab with a table of statistics for the whole group of labelled segments. The same entry is available for single segments and for a selection of segments. These can be exported as CSV files for further analysis outside of WEBKNOSSOS.

While the `Statistics` tab is shown, WEBKNOSSOS makes room for the table: the right-hand panel is widened and the viewports are stacked in one column (the XY, YZ and XZ viewports become tabs above the 3D viewport). On smaller screens, the left-hand panel is closed as well. Your previous layout is restored as soon as you switch to another tab or close the `Statistics` tab. For more than 50 segments, the statistics are only computed after clicking `Compute statistics`.

In cases where you only wish to measure a simple distance or surface area, use the [`Measurement Tool`](../ui/toolbar.md#measurement-and-analysis) instead.

![youtube-video](https://www.youtube.com/embed/PsvC4vNyxJM)
