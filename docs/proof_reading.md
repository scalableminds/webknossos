# Proofreading

webKnossos offers several ways for proofreading large-scale, volumetric segmentations and reconstruction projects.

There are three proofreading workflows supported by webKnossos:
1. The Proofreading tool to correct large segmentation based on an underlying super-voxel graph
2. The Merger-Mode tool
3. Skeleton annotations together with custom scripting

## Proofreading tool

The proofreading tool enables users to fix merge and split errors in a segmentation generated from an automated workflow (outside of webKnossos), e.g. from a machine learning system such as [Voxelytics](https://voxelytics.com). Split and merge operations are directly executed on the underlying [super-voxel graph structure](./terminology.md#agglomerates) of a segmentation. In contrast to the Merger Mode, see below, any modifications to the segmentation are permanently saved by webKnossos.

To use the proofreading tool you need to enable to have an [ID mapping for your segmentation](./volume_annotation.md#mappings--on-demand-agglomeration) enabled to load the super-voxel graph. Once, webKnossos detects this the proofreading tool becomes available on the toolbar (clipboard icon):

1. Select an ID mapping for a segmentation layer from the left-hand side panel
2. From the toolbar, switch to the proofreading tool (clipboard icon)
3. Left-click on any segment to load and display its super-voxel graph
4. Proceed to fix split and merge errors:

To fix a split error:
1. Left-click to select any node of the source segment's graph
2. Right-click on the target segment to bring up the context menu. Select `Merge With Activate Segment`
3. webKnossos will merge both segments and reload the updated super-voxel graph and 3D meshes

To fix a merge error:
1. Left-click to select any node of the source segment's graph
2. Right-click on the target segment to bring up the context menu. Select `Split from active segment (Min-Cut)`
3. webKnossos will perform a min-cut operation to delete all super-voxel graph edges between the source and target segments, effectively splitting the two into individual segments.
4. webKnossos will merge both segments and reload the updated super-voxel graph and 3D meshes

Note, the proofreading operations rely directly on the information and quality of an initial over-segmentation. If cells/segments are already erroneously connected in this state, then webKnossos can not split them apart.

In addition to the handy shortcuts available from the right-click context menu, users can also directly modify the super-voxel graph like any other skeleton to manually add/remove nodes and edges for fine-grained control.

-- The proofreading tool requires a super-voxel graph representation of a segmentation to work. At this time, these can only be obtained from the [Voxelytics AI segmentation pipeline](https://voxelytics.com). We are actively working to make this available for more users, so please reach out to us to get you started and provide feedback: [hello@webknossos.org](mailto:hello@webknossos.org) -- 

## Merger Mode

With the `Merger Mode` tool individual segments (e.g. from over-segmentation) can be combined ("merged") to refine the segmentation and fix split errors. 

To use the `Merger Mode`:
1. From the toolbar, switch to the Skeleton Tool
2. From the toolbar, enable the "Merger Mode" modifier (double arrow icon)
3. Mark connected segments by left-clicking them and placing nodes in the corresponding segments. This process will create a skeleton annotation in the process. Segments connected through this skeleton annotation will be merged into one. Several segments can be combined by making sure that all "correcting nodes" are part of the same tree.

Note, the `Merger Mode` is a rather light-way tool. webKnossos will not directly apply your changes to the underlying segmentation. Rather the `Merger Mode` corrections are applied in real-time based on the currently available skeleton annotations. Disabling the `Merger Mode` will reveal the previous state of the segmentation. Enabling the merge mode will re-apply your corrections.

![Video: ProofReading Volume Annotations](https://www.youtube.com/watch?v=Sq4AuWanK14)

After finishing the proofreading, a [long-running job](./jobs.md) can be started to apply the merging of segments into a new dataset with the same layers. The job can be started by clicking the "Materialize" button next to the merger mode button in the toolbar.

![Button to open the Merger mode long-running job modal](./images/start_merger_mode_job_modal_button.jpg)
![Modal to start the Merger mode long-running job](./images/start_merger_mode_job_modal.jpg)

## ProofReading with skeletons and scripting
In our workflows, we make heavy use of skeleton annotations for proofreading and evaluation. In combination with custom Python scripting we use skeletons:

- to mark error locations as determined by evaluation scripts, e.g. incorrect predictions 
- to label locations for True Positives/False Positive examples, e.g. to debug classifications
- we encode additional metadata for any given segment in the skeleton tree names, groups, and comments, i.e. the biological cell type for a segment
- we manually annotate classification mistakes or interesting features in the data and download/bring them back into our Python workflows for correction and further processing

This system is very flexible, though requires a little bit of creativity and coding skills with the [webKnossos Python library](./tooling#webknossos-python-library).