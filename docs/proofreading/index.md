# Proofreading

WEBKNOSSOS offers several workflows for proofreading large-scale volumetric segmentations and reconstructions.

There are three proofreading workflows supported by WEBKNOSSOS:

1. The [Proofreading tool](proofreading_tool.md) to correct split and merge errors in large segmentations based on an underlying supervoxel graph. To use the proofreading tool, you need a [segmentation mapping](segmentation_mappings.md).
2. The [Merger Mode tool](merger_mode.md), which merges segments via a lightweight skeleton-based mapping.
3. Voxel-based relabeling. Segments can be merged with the fill tool, and there is a dedicated [Split Segments toolkit](split_segments_toolkit.md) for splitting.
