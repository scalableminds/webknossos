# Volume Annotations

WEBKNOSSOS supports volume/segmentation annotations. This annotation type lets you label voxel groups using efficient drawing tools. In the following pages, you will learn: 

- Which [volume annotation tools](../volume_annotation/tools.md) are available and how to use them
- What the [segment list](../volume_annotation/segments_list.md) is
- How to get [statistics](segments_statistics.md) on your segments
- How to [import and export](import_export.md) volume annotations
- How to use [pen tablets and iPads](pen_tablets.md) to annotate on WEBKNOSSOS

Watch this tutorial to get started: 
![youtube-video](https://www.youtube.com/embed/iw2C7XB6wP4?start=120)

### Merging volume annotation with fallback data

After finishing the annotation of a volume layer with a fallback layer, the combined state of these layers can be materialized into a new dataset. For this, go to the layer settings in the left border tab. On the top right of the volume layer is the following button:

![Icon to open the materialize volume annotation modal](../images/materialize_volume_annotation_icon.jpg)

This button opens up a modal that starts a long-running job which will materialize the volume annotation.