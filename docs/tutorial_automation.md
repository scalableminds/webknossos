# Tutorial: Automation and Interoperability

In this tutorial, we will explore two methods for downloading data: 
First, we will use the WEBKNOSSOS UI to download data as a Tiff stack. 
Then, we will learn how to automate this process using Python. 
Additionally, I will guide you through the process of incorporating a remote dataset into WEBKNOSSOS. 
Let’s have a look!

## Download and Export

WEBKNOSSOS makes it easy to [download and export annotations as Tiff images or OME-Tiff](./export.md#data-export-through-the-ui). 
Start by creating a bounding box with the bounding box tool. Adjust it so that it covers the desired area.

![type:video](https://static.webknossos.org/assets/docs/tutorial-data-sharing/01_create_bounding_box.mp4){: autoplay loop muted}

Then, access the “Download” option from the dropdown menu and select “Tiff Export”. 
Choose which layer you want to export and the bounding box covering the region you want to download. 
Click “Export” and that’s it! 
The Tiff stack will be downloaded to your computer.

![type:video](https://static.webknossos.org/assets/docs/tutorial-data-sharing/02_export_as_tiff.mp4){: autoplay loop muted}

To [automate this process with Python](./export.md#data-export-through-python), follow the same initial steps. 
Select “Python client” in the download modal, then copy the provided code snippet to get started. 
You can also use the [Python library documentation](https://docs.webknossos.org/webknossos-py/) for more code examples on interacting with your data.

![type:video](https://static.webknossos.org/assets/docs/tutorial-data-sharing/03_copy_python_code.mp4){: autoplay loop muted}

Run the code with Python on your computer to start the download process. 
Extend the code as needed for more compless automations. 
The Python libraries offers both "normal" download of datasets and streaming access for working with larger files.

## Interopability with Other Software Tools

![type:video](https://static.webknossos.org/assets/docs/tutorial-data-sharing/04_run_the_code.mp4){: autoplay loop muted}

WEBKNOSSOS integrates seamlessly with other analysis software tools, enabling you to work with datasets from tools like Neuroglancer and Fiji. Let’s see an example of [importing a Neuroglancer dataset](./datasets.md#working-with-zarr-neuroglancer-precomputed-and-n5-datasets) into WEBKNOSSOS.

First, find a released dataset in OME-Zarr, N5 or Neuroglancer-Precomputed format that you would like to import and that is hosted in the cloud (S3, Google Cloud) or on any HTTPs server. 
Copy the URL pointing to the data. 
In WEBKNOSSOS, navigate to the dashboard and click on “Add dataset”.
Select the “Add remote dataset” tab. 
Paste the link, then click “Add layer”. 
Similar to adding local data, choose a target folder. 
Provide a name for your dataset, set the voxel size, and click “Import”. 
Once the dataset is imported, open it to start exploring!

![type:video](https://static.webknossos.org/assets/docs/tutorial-data-sharing/05_import_n5.mp4){: autoplay loop muted}

--

That’s it, now you know how to export data using the UI or Python as well as how to work with remote datasets. 