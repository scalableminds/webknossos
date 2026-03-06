# Mappings / On-Demand Agglomeration

WEBKNOSSOS can apply precomputed agglomeration files to remap and combine over-segmented volume annotations on demand. Instead of materializing multiple agglomeration results as separate segmentation layers, ID mappings let you switch between agglomeration strategies interactively.

This feature works well with automated machine-learning segmentation workflows. It is common to generate multiple agglomeration results (for example with different prediction or size thresholds) from one base over-segmentation and compare them in WEBKNOSSOS.

![youtube-video](https://www.youtube.com/embed/ZmUqyIoA9Gw)

Mapping files are automatically detected when placed in an `agglomerates` folder inside the [segmentation folder](../data/wkw.md#wkw-folder-structure). All available mappings can be activated from the dropdown of each `Segmentation` layer. You can switch between mappings at any time, and WEBKNOSSOS updates the rendered result accordingly.

Mapping files are stored as HDF5 files. [Read the section on data formats for more information on the file formats](../data/concepts.md#id-mapping-files).
