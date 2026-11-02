## Import Volume Annotations

Any volume annotation exported from WEBKNOSSOS or the WEBKNOSSOS Python library in a ZIP archive can be imported in one of two ways:

- **From the dashboard** — drag and drop the ZIP file onto the annotation list to create a new annotation. It will open automatically and appear in your annotation list.
- **From within an open annotation** — drop the ZIP file anywhere in the WEBKNOSSOS viewer to merge the imported data into the current annotation. The volume layer must already exist in the annotation before importing.

For importing skeleton-only (NML) files without volume data, see [Import & Export in Skeleton Annotations](../skeleton_annotation/import_export.md).

## Export Volume Annotations

To download an annotation, open **Menu > Download**, choose the data you want, and select a format (WKW or Zarr). You can also go to your annotation dashboard and click **Download** next to the annotation.

For a full overview of all export and download options — including TIFF cutouts and Python library access — see [Data Export through the Web UI](../data/export_ui.md).

![youtube-video](https://www.youtube.com/embed/l8ZacNqvMzI)

A volume annotation is exported as a `.zip` file containing two parts:

- An [NML file](../data/concepts.md#nml-files) — carries the annotation metadata, segment information, and layer configuration.
- A volume data `.zip` — holds the actual voxel label data in either WKW or Zarr format.

Annotations created with the [proofreading tool](../proofreading/proofreading_tool.md) are exported differently: instead of voxel data, the ZIP contains the merge and split edits of the supervoxel graph. See [Exporting Proofreading Results](../proofreading/proofreading_tool.md#exporting-proofreading-results) for details on the format, re-uploading, and limitations.

## Merging volume annotation with fallback data

When annotating a volume layer, you can work on top of an existing segmentation from the dataset — known as a [fallback layer](../data/concepts.md#volume-element). Rather than copying the entire segmentation upfront, WEBKNOSSOS stores only your edits in the annotation layer and reads everything else directly from the original segmentation. This keeps annotations lightweight while still letting you see and build on the existing data.

Once you are done annotating, you can permanently combine both layers into a single, self-contained segmentation in a new dataset. Your annotation edits take precedence wherever you made changes; the original fallback segmentation fills in the rest. This process is sometimes referred to as **materialization**.

To start it, go to the `Layers` tab in the left sidebar, hover over the three-dot menu next to the name of the volume layer, and select `Merge this volume annotation with its fallback layer`.

![Layer menu entry to open the materialize volume annotation dialog](../images/materialize_volume_annotation_icon.jpg)
/// caption
Layer menu entry to open the materialize volume annotation dialog
///

This opens a dialog that submits a long-running job to materialize the volume annotation into a new dataset. Materializing a volume annotation may take a long time, depending on the size of the annotation and the dataset.

You can also materialize annotations made with the proofreading tool. In that case, you need to select a bounding box to export. See [Materializing a Proofread Segmentation](../proofreading/proofreading_tool.md#materializing-a-proofread-segmentation-into-a-new-dataset).

!!! info
    This feature is only available to admins and dataset managers, on webknossos.org or on managed instances that have the WEBKNOSSOS worker configured.
