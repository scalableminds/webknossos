# Pre-Computed Mesh Generation
Instead of having to slowly compute individual mesh every time you open a dataset, it might make more sense to pre-compute and save all meshes within a dataset. Pre-computed meshes have the advantage of loading very quickly - even for larger meshes.

You can start mesh generation from the `Segments` tab in the right-hand side panel. Click on the little plus button to initiate the mesh generation. We recommend computing the meshes in the medium quality (default) to strike a good balance between visual fidelity, compute time, and GPU resource usage. 

!!! info
    Pre-computed meshes are exclusive to webknossos.org. Contact [sales](mailto:sales@webknossos.org) for access to the integrated WEBKNOSSOS worker for meshing or the [Voxelytics software](https://voxelytics.com) for standalone meshing from the command line.

[Check the `Processing Jobs` page](../automation/jobs.md) from the `Admin` menu at the top of the screen to track progress or cancel the operation. The finished, pre-computed mesh will be available on page reload. 
