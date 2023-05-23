# Tutorial: Volume Annotation with WEBKNOSSOS

In this tutorial, we will explore the volume annotation features of WEBKNOSSOS. We will cover everything from opening and annotating a published dataset to utilizing both basic and advanced annotation tools. Additionally, I will explain a few things about meshes and provide insights into the layer system of WEBKNOSSOS. Let’s get started!

<!--
Here is full tutorial video, alternatively continue reading below.

![type:video Tutorial: Volume Annotation with WEBKNOSSOS](TODO add YouTube link) -->

If you already have an account, go to the “featured publications” page. Alternatively, sign up for free in less than a minute on [https://webknossos.org](https://webknossos.org).

Select a dataset from the list of publications to start annotating a demo dataset. You can also open one of your own datasets (if you want to learn how to upload a dataset to WEBKNOSSOS, watch our tutorial on how to upload your own data).

## Creating an Annotation

Click on “create annotation” to begin. Navigate through the dataset and zoom in to find the cell you want to annotate.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/01_create_annotation.mp4){: autoplay loop muted}

Select the brush tool to create your first volume annotation. Brush over a segment. Use the eraser tool to correct mistakes.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/02_brushing_and_erasing.mp4){: autoplay loop muted}

Create a new segment by selecting a new segment ID. Use the trace tool to draw more precise contours.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/03_new_segments_lasso.mp4){: autoplay loop muted}

## Smart Annotation Tools

Now, let’s explore the smart tools of WEBKNOSSOS. Choose the quick-select tool and draw a rectangle around the cell you want to segment. Scroll to the next slice and repeat.

Annotating a nucleus with the quick-select tool.
Next, jump a few more slices in the Z direction. Annotate your cell again. Click the “interpolation” tool and congratulations! WEBKNOSSOS just segmented each slice in between the two and saved you time. Repeat this super fast workflow as much as you need.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/05_interpolating.mp4){: autoplay loop muted}

## 3D Meshes

Right-click on your freshly annotated segment and click on “compute mesh”. Hide the planes in the 3D viewport to fully enjoy your 3D mesh.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/06_computing_mesh.mp4){: autoplay loop muted}

To have a look at even more impressive meshes, go to the featured publication and choose a dataset with an existing mesh file. Right-click on a segment and choose “load mesh”. Maximize the 3D viewport and enjoy the view!

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/07_mesh_PB.mp4){: autoplay loop muted}

## Layer System

WEBKNOSSOS works with a layer system, similar to Photoshop. You will usually have the “raw data” layer at the top, as well as optional additional color layers. You can change the opacity of the layers and use the histograms to adjust the contrast of your data.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/08_layer_system_01.mp4){: autoplay loop muted}

Turning on a color layer, changing the opacity, and adjusting the contrast with the histogram.
Then, you will find the segmentation layers for volume and skeleton annotations. You can toggle the visibility and set the opacity of the annotations as needed. Once a volume annotation layer is active, you can start annotating.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/09_toggling_visibility.mp4){: autoplay loop muted}
