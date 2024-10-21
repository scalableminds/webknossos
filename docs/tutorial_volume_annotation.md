# Tutorial: Volume Annotation with WEBKNOSSOS

In this tutorial, we will explore the volume annotation features of WEBKNOSSOS. We will cover everything from opening and annotating a published dataset to utilizing both basic and advanced annotation tools. Additionally, I will explain a few things about meshes and provide insights into the layer system of WEBKNOSSOS. Let’s get started!

Here is full tutorial video, alternatively continue reading below.

![youtube-video](https://www.youtube.com/embed/nWJ-ZmFJiN8)

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
Now, let’s explore the smart tools of WEBKNOSSOS. First, activate the quick-select tool. In the settings, choose the number of sections you'd like to predict. Then, click on a cell to automatically segment it across the chosen number of sections. Repeat this process as much as needed and you will have your cell segmented in no time! Alternatively, you can draw a rectangle around the cell you'd like to segment.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/04_new_AI_quick_select.mp4){: autoplay loop muted}

Quick tip: The current zoom is taken into account when using the quick select feature. Therefore, smaller structures can be segmented better when being zoomed in further. And another tip: When dealing with long and complex shapes, try drawing multiple rectangles on different areas. The annotations will merge and your complex shape will be segmented in no time.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/04_new_tip_long_cell.mp4){: autoplay loop muted}

Now, annotate a segment on a new slice. Skip a few sections forward and annotate again. To interpolate the two sections, click the “interpolation” tool. All the slices in between the two original ones have now been automatically annotated by WEBKNOSSOS.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/05_interpolating.mp4){: autoplay loop muted}

Repeat this super fast workflow as much as you need. The combination of these two tools enables highly efficient 3D annotation.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/05_new_interpolation.mp4){: autoplay loop muted}

## 3D Meshes

Right-click on your freshly annotated segment and click on “compute mesh”. Hide the planes in the 3D viewport to fully enjoy your 3D mesh.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/06_computing_mesh.mp4){: autoplay loop muted}

To have a look at even more impressive meshes, go to the featured publication and choose a dataset with an existing mesh file. Right-click on a segment and choose “load mesh”. Maximize the 3D viewport and enjoy the view!

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/07_mesh_PB.mp4){: autoplay loop muted}

## Layer System

WEBKNOSSOS works with a layer system, similar to Photoshop. You will usually have the “raw data” layer at the top, as well as optional additional color layers. You can change the opacity of the layers and use the histograms to adjust the contrast of your data.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/08_layer_system_01.mp4){: autoplay loop muted}

Then, you will find the segmentation layers for volume and skeleton annotations. You can toggle the visibility and set the opacity of the annotations as needed. Once a volume annotation layer is active, you can start annotating.

![type:video](https://static.webknossos.org/assets/docs/tutorial-volume-annotation/09_toggling_visibility.mp4){: autoplay loop muted}
