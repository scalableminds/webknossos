# Tutorial: Automation and Interoperability

In this tutorial, we will explore two methods for downloading data:
First, we will use the WEBKNOSSOS UI to download data as a Tiff stack.
Then, we will learn how to automate this process using Python.
Additionally, I will guide you through the process of incorporating a remote dataset into WEBKNOSSOS.
Let’s take a look!

Here is full tutorial video, alternatively continue reading below.

![youtube-video](https://www.youtube.com/embed/Cz98_zO1Z2w)

## Download and Export

WEBKNOSSOS makes it easy to [download and export annotations as Tiff images or OME-Tiff](./data/export_ui.md).
Start by creating a bounding box with the bounding box tool. Adjust it so that it covers the desired area.

![type:video](https://static.webknossos.org/assets/docs/tutorial-automation/01_create_bounding_box.mp4){: autoplay loop muted}

Then, access the “Download” option from the dropdown menu and select “Tiff Export”.
Choose which layer you want to export and the bounding box covering the region you want to download.
Click “Export” and that’s it!
The Tiff stack will be downloaded to your computer.

![type:video](https://static.webknossos.org/assets/docs/tutorial-automation/02_export_as_tiff.mp4){: autoplay loop muted}

To [automate this process with Python](./data/export_python.md), follow the same initial steps.
Select “Python client” in the download dialog, then copy the provided code snippet to get started.
You can also use the [Python library documentation](https://docs.webknossos.org/webknossos-py/) for more code examples on interacting with your data.

![type:video](https://static.webknossos.org/assets/docs/tutorial-automation/03_copy_python_code.mp4){: autoplay loop muted}

Run the code with Python on your computer to start the download process.
Extend the code as needed for more complex automations.
The Python libraries offer both "normal" download of datasets and streaming access for working with larger files.

![type:video](https://static.webknossos.org/assets/docs/tutorial-automation/04_run_the_code.mp4){: autoplay loop muted}

## Interoperability with Other Software Tools

WEBKNOSSOS integrates seamlessly with other analysis software tools, enabling you to work with datasets from tools like Neuroglancer and Fiji. 
Let’s see an example of [importing a Neuroglancer dataset](./data/streaming.md) into WEBKNOSSOS.

First, find a released dataset in OME-Zarr, N5 or Neuroglancer-Precomputed format that you would like to import and that is hosted in the cloud (S3, Google Cloud) or on any HTTPS server.
Copy the URL pointing to the data.

In WEBKNOSSOS, navigate to the dashboard:

1. Click on “Add dataset”.
2. Select the “Add remote dataset” tab.
3. Paste the URL, then click “Add layer”.
4. Similar to adding local data, choose a target folder.
5. Provide a name for your dataset, set the voxel size, and click “Import”.

Once the dataset is imported, open it to start exploring!

![type:video](https://static.webknossos.org/assets/docs/tutorial-automation/05_import_n5.mp4){: autoplay loop muted}

---

That’s it, now you know how to export data using the UI or Python as well as how to work with remote datasets.
