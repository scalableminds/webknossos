## Import Volume Annotations

To import a volume annotation, ensure it is in the correct format (WKW or Zarr) and compressed in a zip folder. Next, navigate to your annotation dashboard and simply drag and drop the zip folder into the WEBKNOSSOS interface. The annotation will automatically open, allowing you to edit it as usual. It will also be added to your annotation list for future access.

## Export Volume Annotations
To export (download) an annotation, go to **Menu > Download**. From there, select the data you want to download and choose the desired format (WKW, Zarr). Alternatively, you can open your annotation dashboard and click **Download** next to the annotation.

![youtube-video](https://www.youtube.com/embed/l8ZacNqvMzI)

## Merging volume annotation with fallback data

After finishing the annotation of a volume layer with a fallback layer, the combined state of these layers can be materialized into a new dataset. For this, go to the layer settings in the left border tab. On the top right of the volume layer is the following button:

![Icon to open the materialize volume annotation dialog](../images/materialize_volume_annotation_icon.jpg)
/// caption
Icon to open the materialize volume annotation dialog
///

This button opens up a dialog that starts a long-running job which will materialize the volume annotation.

## Restricting magnifications

WEBKNOSSOS allows data annotation in different magnifications.
Restricting the available magnifications can greatly improve the performance when annotating large structures, such as nuclei, since the volume data does not need to be stored in all quality levels. 
How to read: Mag 1 is the most detailed, 4-4-2 is downsampled by factor 4 in x and y, and by factor 2 in z.
When annotating large structures, consider restricting the available magnifications in this specific annotation or in this volume annotation layer.

### Restricting magnifications for a whole annotation

Go to the dataset dashboard. Click on the three dots next to `New Annotation` for the dataset you want to annotate. Use the slider to restrict the volume magnifications, e.g. by omitting the finest magnification, which is usually 1-1-1, or the two finest magnifications.

### Restricting magnifications for volume annotation layers

Within an existing annotation, go to the `Layers` tab on the left. Click `Add Volume Annotation Layer` at the bottom of the list of all layers in this annotation. Restrict the magnifications as explained above.