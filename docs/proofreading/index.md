# Proofreading

WEBKNOSSOS offers several ways for proofreading large-scale, volumetric segmentations and reconstruction projects.

There are three proofreading workflows supported by WEBKNOSSOS:

1. The [Proofreading tool](proofreading_tool.md) to correct split and merge errors in large segmentations based on an underlying super-voxel graph. To use the proofreading tool, you need a [segmentation mapping](segmentation_mappings.md).
2. The [Merger-Mode tool](merger_mode.md) which allows merging of segments by constructing a lightweight skeleton-based mapping.
3. Voxel-based relabeling of segments. Segments can be merged using the fill tool. To split segments there is a dedicated [Split Segments toolkit](split_segments_toolkit.md).
