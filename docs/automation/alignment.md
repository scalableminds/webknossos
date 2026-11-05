# Image Alignment

For single-tile image stacks, an alignment is directly possible from within WEBKNOSSOS.
Simply upload the dataset, open it and select the "AI Analysis" button in the toolbar. From the dropdown, choose "Run AI Alignment".

This will open a dialog where you can configure and start the alignment.

![youtube-video](https://www.youtube.com/embed/Rt3uG31r2bI?si=X_OvnfesgD7-xLTq)

## Select AI Alignment Task

*   **Align Sections:** Align all sections of this dataset along the Z-axis using features in neighboring sections. This only supports datasets with a single tile per section (no in-plane stitching needed).
*   **Align & stitch multiple tiles:** Datasets with multiple tiles per section can be aligned and stitched via [alignment projects](#alignment-projects) (beta). Alternatively, contact us via email for a quote. [Learn more about our alignment services.](https://webknossos.org/services/alignment)

## Alignment Settings

*   **New Dataset Name:** The name of the new dataset that will be created with the aligned images.
*   **Manual Matches:** You can use manual matches from a skeleton annotation to help the alignment process in specific spots. This can be useful for particularly hard-to-align sections. When manual landmarks are used, they don't need to cover the entire dataset. Instead, these manual landmarks can be placed to help with tricky cases such as a big gap, tear or jump between two sections. 

    We recommend adding at least 3 manual matches per section pair, though 5–10 evenly distributed matches across the section typically give better results. Sections without manual matches will continue to be aligned automatically, so you can guide alignment only in challenging regions while the remaining sections are processed automatically.

    ![youtube-video](https://www.youtube.com/embed/8IEl4m_Zg1A?si=v0UC3tTMrrcEoudj)

## Credit Information

This section provides an overview of your available credits in your organization and the estimated cost for the alignment. Cost varies depending on the size of your dataset.

Computation time for the alignment depends directly on the size of your dataset. The finished analysis will be available as a new dataset from your dashboard. You can monitor the status and progress of the analysis job from the [`Processing Jobs` page](./jobs.md) or wait for the email notification.

For multi-tile image stacks, use [alignment projects](#alignment-projects) (beta) or refer to our [alignment services](https://webknossos.org/services/alignment).

## Alignment Projects

Alignment projects (beta) enable the alignment and stitching of image stacks with multiple tiles per section.
An alignment project holds the unaligned tile images together with a CSV file that specifies the position of each tile.
The data is uploaded once, after which one or more alignments can be computed from it, e.g. with different settings.
Each alignment produces a new dataset.

To create an alignment project, select `Analysis > Alignment Projects` in the navbar and click `New Alignment Project`.
Add a folder or a ZIP archive containing the tile images and exactly one tile CSV, and specify a name and the voxel size of the data.
After the upload, the project page lists the project details and its alignments. Start a new alignment with `Start Alignment`.
As with other jobs, the progress can be monitored on the [`Processing Jobs` page](./jobs.md).

Since alignment projects in WEBKNOSSOS are still in beta, please [contact us](mailto:hello@webknossos.org) for larger projects or consider our [alignment services](https://webknossos.org/services/alignment).

### Tile CSV Format

The tile CSV lists one tile per row, with the columns `section,x,y,path`:

```csv
section,x,y,path
1,0,0,./section_001/tile_0_0.tif
1,2048,0,./section_001/tile_1_0.tif
2,0,0,./section_002/tile_0_0.tif
2,2048,0,./section_002/tile_1_0.tif
```

- `section`: The section index (integer). The section indices must be contiguous, but may start at any value.
- `x`, `y`: The initial position of the tile within its section, in pixels.
- `path`: The path of the tile image, relative to the CSV file. Paths must not point outside of the CSV's directory.

A header row is optional, and additional columns after `path` are ignored.

The CSV is validated after the upload. If it is invalid, the project page states the reason.
The CSV can then be replaced on the project page without uploading the image data again, e.g. to correct initial tile positions or to exclude tiles from subsequent alignments.
A replacement CSV is stored in the same directory as the original one, so its paths need to be relative to that directory.
Alignments that are running or already finished keep using the CSV they were started with.

Currently, the tile CSV is the only supported input format. Further input formats will be supported in the future.

!!! info
    Alignment projects are only available to admins and dataset managers. They require the WEBKNOSSOS worker, so they are available on webknossos.org and on managed instances where the worker is set up.
