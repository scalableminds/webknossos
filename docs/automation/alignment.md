# Image Alignment

For single-tile image stacks, an alignment is directly possible from within WEBKNOSSOS.
Simply upload the dataset, open it and select the "AI Analysis" button in the toolbar. From the dropdown, choose "Run AI Alignment".

This will open a dialog where you can configure and start the alignment.

## Select AI Alignment Task

*   **Align Sections:** Align all sections of this dataset along the Z-axis using features in neighboring sections. This only supports datasets with a single tile per section (no in-plane stitching needed).
*   **Align & stitch multiple tiles:** (Coming Soon) For stitching and aligning datasets with multiple tiles per section, please contact us via email for a quote. [Learn more about our alignment services.](https://webknossos.org/services/alignment)

## Alignment Settings

*   **New Dataset Name:** The name of the new dataset that will be created with the aligned images.
*   **Manual Matches:** You can use manual matches from a skeleton annotation to guide the alignment process. This can be useful for particularly hard-to-align sections. When manual landmarks are used, they don't need to cover the entire dataset. In most cases, these these manual landmarks are not necessary but they can help for tricky cases such as a big gap, tear or jump between two sections.

## Credit Information

This section provides an overview of your available credits in your organization and the estimated cost for the alignment. Cost varies depending on the size of your dataset.

Computation time for the alignment depends directly on the size of your dataset. The finished analysis will be available as a new dataset from your dashboard. You can monitor the status and progress of the analysis job from the [`Processing Jobs` page](./jobs.md) or wait for the email notification.

For multi-tile image stacks, please refer to our [Alignment services](https://webknossos.org/services/alignment).
