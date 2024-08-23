# Jobs

webknossos.org includes several compute-intensive and automated workflows that are processed in the background. Depending on the operation and dataset size, these workflows may take some time (from minutes to hours) to finish. 

WEBKNOSSOS will notify you via email upon completion or failure of any job.

Example workflows:

- [converting datasets on upload](./datasets.md#uploading-through-the-web-browser)
- [automated analysis](./automated_analysis.md), e.g., nuclei inferral 
- [mesh file (pre)-computation](./mesh_visualization.md)
- [applying a merger mode annotation](./volume_annotation.md#proof_reading_and_merging_segments)
- automatic inference of a segmentation layer's large segment ID
- [dataset & annotation export as Tiff files](./export.md#data-export-through-the-ui)
- [creating engaging animations of datasets](./animations.md)
- downsampling volume annotations

These workflows are executed in background worker tasks as so-called *processing jobs*. 

!!! info
    These workflows are exclusive to webknossos.org. Contact [sales](mailto:sales@webknossos.org) for access to the WEBKNOSSOS worker or [Voxelytics](https://voxelytics.com) for the job processing.

## Listing Processing Jobs
A list of all past and currently running jobs can be found in the administration menu in the navbar (Administration -> *Processing Jobs*).

Depending on the job workflow you may:

- view the resulting resource, e.g., a new segmentation 
- download the data, e.g., [Tiff export](./export.md#data-export-through-the-ui)

![Overview of the Jobs page](../images/jobs.jpeg)

We constantly monitor job executions. In rare cases, jobs can fail, and we aim to re-run them as quickly as possible. In case you run into any trouble please [contact us](mailto:hello@webknossos.org).
