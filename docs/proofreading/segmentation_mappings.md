# Mappings / On-Demand Agglomeration

WEBKNOSSOS can apply precomputed agglomeration files to remap and combine over-segmented volume annotations on demand. Instead of materializing multiple agglomeration results as separate segmentation layers, ID mappings let you switch between agglomeration strategies interactively.

This feature works well with automated machine-learning segmentation workflows. It is common to generate multiple agglomeration results (for example with different prediction or size thresholds) from one base over-segmentation and compare them in WEBKNOSSOS.

![youtube-video](https://www.youtube.com/embed/ZmUqyIoA9Gw)

HDF5 mapping files are automatically detected when placed in an `agglomerates` folder inside the [segmentation folder](../data/wkw.md#wkw-folder-structure). Mappings in the zarr3-based format or on remote object storage need to be registered as `attachments` in the dataset's `datasource-properties.json`. All available mappings can be activated from the dropdown of each `Segmentation` layer. You can switch between mappings at any time, and WEBKNOSSOS updates the rendered result accordingly.

Mapping files are stored as HDF5 files or in a zarr3-based format. [Read the section on data formats for more information on the file formats](../data/concepts.md#id-mapping-files).

## Comparing Agglomerate Skeletons to a Reference Agglomerate View
When several agglomerate files exist for a segmentation layer, you can compare the agglomerates of one file to those of another. This shows how two agglomeration strategies differ for a specific cell.

1. Activate an agglomerate file mapping for the segmentation layer in a skeleton or hybrid annotation.
2. In the settings of the segmentation layer in the [Layers tab](../ui/layers.md), select a **Reference Agglomerate View**, i.e., the other agglomerate file to compare against.
3. Load an agglomerate skeleton with ++shift++ + middle-click on a segment or via **Import Agglomerate Tree** in the context menu.

WEBKNOSSOS compares the loaded agglomerate to the agglomerate of the reference view that contains the clicked segment. Edges that only exist in the loaded agglomerate are shown in green, edges that only exist in the reference agglomerate are shown in orange. The agglomerate skeleton itself is dimmed, so that the differences stand out.

The comparison is only displayed and not saved with the annotation. It is computed again when the annotation is opened, the reference view is changed or the mapping is activated again. A switch below the reference view hides or shows all comparisons, and the comparison of an agglomerate skeleton is hidden together with that skeleton. The settings also summarize the added and removed edges and list the reasons if some comparisons failed, e.g., because an agglomerate is too large.

The comparison is not available during [supervoxel proofreading](./proofreading_tool.md) (editable mappings).

## Mapping Locking
In the context of an annotation, as soon as you modify a volume layer that has an active mapping — whether by proofreading or simply by brushing — that mapping becomes *locked* in the annotation. A locked mapping can no longer be substituted or disabled, which guarantees that the stored annotation always refers to a consistent agglomeration. This can only be reverted by restoring an older version of the annotation.

## Editable Mappings for Supervoxel Proofreading

The mappings described above are read-only: activating one lets you browse a precomputed agglomeration without changing it. [Supervoxel Proofreading](./proofreading_tool.md) builds on this by turning the active agglomerate mapping into an *editable* copy of the underlying supervoxel graph. Your merge and split operations are applied to this editable mapping and are stored together with your annotation — they do not modify the original dataset, so different annotations can proofread the same base segmentation independently.

Note that supervoxel proofreading is mutually exclusive with some other features: while one is active, regular volume annotation is disabled, and [Merger Mode](./merger_mode.md) cannot be enabled.
