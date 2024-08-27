# Proofreading Tool

The proofreading tool enables users to fix merge and split errors in a segmentation generated from an automated workflow (outside of WEBKNOSSOS), e.g. from a machine learning system such as [Voxelytics](https://voxelytics.com). Split and merge operations are directly executed on the underlying [super-voxel graph structure](../terminology.md#agglomerates) of a segmentation.

To use the proofreading tool you need to enable an [ID mapping for your segmentation](./segmentation_mappings.md) to load the super-voxel graph. Once, WEBKNOSSOS detects this the proofreading tool can be activated on the toolbar (clipboard icon):

1. Select an ID mapping for a segmentation layer from the left-hand side panel
2. From the toolbar, switch to the proofreading tool (clipboard icon)
3. [Optional] Shift + middle-click on any segment to load and display its super-voxel graph
4. Proceed to fix split and merge errors:

## Fixing Split Errors

1. Left-click on any part of the source segment. It will be marked with a white crosshair
2. Right-click on the target segment to bring up the context menu. Select `Merge With Active Segment`
3. WEBKNOSSOS will merge both segments and reload the updated segmentation and 3D meshes

## Fixing Merge Errors

1. Left-click on any part of the source segment. It will be marked with a white crosshair
2. Right-click on the part of the source segment that you would like to split off to bring up the context menu. Select `Split from active segment (Min-Cut)`
3. WEBKNOSSOS will perform a min-cut operation to delete all super-voxel graph edges between the source and target segments, effectively splitting the two into individual segments
4. WEBKNOSSOS will split both segments and reload the updated segmentation and 3D meshes

Note, the proofreading operations rely directly on the information and quality of an initial over-segmentation. If cells/segments are already erroneously connected in this state, then WEBKNOSSOS cannot split them apart (this might change in the future, though).

If case you want to reload, hide or remove a 3D mesh during proofreading, you can use the context menu in the 3D viewport by hovering the mesh. You can enable and disable the automatic mesh loading by toggling the respective button in the toolbar, right of the proofreading tool button.

In addition to the handy shortcuts available from the right-click context menu, users can also directly modify the super-voxel graph like any other skeleton to manually add/remove nodes and edges for fine-grained control.

!!!info 
    The proofreading tool requires a super-voxel graph representation of a segmentation to work. At this time, these can only be obtained from the [Voxelytics AI segmentation pipeline](https://voxelytics.com). We are actively working to make this available for more users, so please reach out to us to get you started and provide feedback: [hello@webknossos.org](mailto:hello@webknossos.org)

## Proofreading with Skeletons and Custom Scripting

In our workflows, we make heavy use of skeleton annotations for proofreading and evaluation. In combination with custom Python scripting we use skeletons:

- to mark error locations as determined by evaluation scripts, e.g. incorrect predictions
- to label locations for True Positives/False Positive examples, e.g. to debug classifications
- we encode additional metadata for any given segment in the skeleton tree names, groups, and comments, i.e. the biological cell type for a segment
- we manually annotate classification mistakes or interesting features in the data and download/bring them back into our Python workflows for correction and further processing

This system is very flexible, though requires a little bit of creativity and coding skills with the [WEBKNOSSOS Python library](https://docs.webknossos.org/webknossos-py).
