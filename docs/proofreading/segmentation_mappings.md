# Mappings / On-Demand Agglomeration

With WEBKNOSSOS it is possible to apply a precomputed agglomeration file to re-map/combine over-segmented volume annotations on-demand. Instead of having to materialize one or more agglomeration results as separate segmentation layers, ID mappings allow researchers to apply and compare different agglomeration strategies of their data for experimentation.

This feature works well with automated machine learning segmentation workflows. We typically produce several agglomeration results based on different prediction and size thresholds leading to several possible segmentations based on one initial over-segmentation. We load these ID maps into WEBKNOSSOS to quickly review these results in an interactive session.

![youtube-video](https://www.youtube.com/embed/ZmUqyIoA9Gw)

Mapping files are automatically identified by WEBKNOSSOS when being placed in a `agglomerates` folder within the [segmentation folder](../data/wkw.md#wkw-folder-structure). All available mappings can be activated from a dropdown under each `Segmentation` layer. Users can easily switch between several mappings and WEBKNOSSOS will update accordingly.

Mapping files are stored as HDF5 files. [Read the section on data formats for more information on the file formats](../data/concepts.md#id-mapping-files).

<!-- ![An example of applying a mapping file to agglomerate individual segments from an automated over-segmentation. WEBKNOSSOS applies the agglomeration on-demand and allows for quick reviews of different agglomeration strategies.](videos/11_mapping.mp4) -->

