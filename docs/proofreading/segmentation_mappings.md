# Mappings / On-Demand Agglomeration

WEBKNOSSOS can apply precomputed agglomeration files to remap and combine over-segmented volume annotations on demand. Instead of materializing multiple agglomeration results as separate segmentation layers, ID mappings let you switch between agglomeration strategies interactively.

This feature works well with automated machine-learning segmentation workflows. It is common to generate multiple agglomeration results (for example with different prediction or size thresholds) from one base over-segmentation and compare them in WEBKNOSSOS.

![youtube-video](https://www.youtube.com/embed/ZmUqyIoA9Gw)

Mapping files are automatically detected when placed in an `agglomerates` folder inside the [segmentation folder](../data/wkw.md#wkw-folder-structure). All available mappings can be activated from the dropdown of each `Segmentation` layer. You can switch between mappings at any time, and WEBKNOSSOS updates the rendered result accordingly.

Mapping files are stored as HDF5 files. [Read the section on data formats for more information on the file formats](../data/concepts.md#id-mapping-files).

## Mapping Locking
In the context of an annotation, as soon as you modify a volume layer that has an active mapping — whether by proofreading or simply by brushing — that mapping becomes *locked* in the annotation. A locked mapping can no longer be substituted or disabled, which guarantees that the stored annotation always refers to a consistent agglomeration. This can only be reverted by restoring an older version of the annotation.

## Editable Mappings for Supervoxel Proofreading

The mappings described above are read-only: activating one lets you browse a precomputed agglomeration without changing it. [Supervoxel Proofreading](./proofreading_tool.md) builds on this by turning the active agglomerate mapping into an *editable* copy of the underlying supervoxel graph. Your merge and split operations are applied to this editable mapping and are stored together with your annotation — they do not modify the original dataset, so different annotations can proofread the same base segmentation independently.

Note that supervoxel proofreading is mutually exclusive with some other features: while one is active, regular volume annotation is disabled, and [Merger Mode](./merger_mode.md) cannot be enabled.
