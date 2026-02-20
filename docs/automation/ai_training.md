# AI Model Training

WEBKNOSSOS allows you to train your own AI models for image segmentation.

## Preparing Your Annotations

Before you can start training, prepare your ground truth annotation. Here is a short, step-by-step guide to prepare your data:

1.  **Create an annotation:** Start by creating a new annotation or opening an existing one.
2.  **Define bounding boxes:** Create one or more bounding boxes that define the areas you want to use for training. Learn more on how to define bounding boxes and choosing the right magnification for your training in [this guide](choosing_mags_and_bboxes.md).
    - It is important that the bounding boxes are not too small. WEBKNOSSOS checks that each bounding box has a minimum extent of **32 voxels in each dimension**. We recommend that each box has dimensions of at least **`85 × 85 × 30 voxels`** for neuron finetuning and **`64 × 64 × 64`** or **`96 x 96 x 32 voxels`** for instance training. 
    - Bounding boxes that are not aligned with the selected magnification will be automatically shrunk to fit.
    - For optimal training, all bounding boxes should have dimensions that are multiples of the smallest box dimensions.
3.  **Label segments:** Within your bounding boxes, label the segmentation of your structures of interest. Use the volume annotation tool to manually annotate structures. This will be your ground truth data. For neurons, we recommend to densely label each structure with a unique ID. For instances segmentations you only need to label the structures you want to train on, e.g. nuclei, mitochondria, soma, vesicles, etc., making sure they have unique segment IDs as well.

For a detailed tutorial and general annotations guidelines, please see [here](../tutorials/trainingdata_annotation.md) or watch this tutorial. ![youtube-video](https://www.youtube.com/embed/MlT4MgU6ayw?si=kGP_cAO72sjpNY6g)

## Configuring the Training
To start a training, click on the `AI Analysis` button in the toolbar and select `Train AI model` from the dropdown menu.
This will open a dialog where you can configure and start your training job.
### Select AI Training Task

First, you need to select the type of model you want to train. Both models are optimized for SEM, FIB-SEM, SBEM, and Multi-SEM microscopes:

*   **EM Neuron Model:** Train a new AI model for dense EM neuron segmentation.
*   **EM Instances Model:** Train a new AI model for EM instance segmentation. This is optimized for nuclei, mitochondria, and other cell types.
### Training Data

In this section, you need to specify the data that will be used for training.

*   **Image Data Layer:** Select the raw image layer.
*   **Ground Truth Layer:** Select the segmentation layer that you created.
*   **Magnification:** Choose the magnification that should be used for training. Read more about [choosing a magnification](./choosing_mags_and_bboxes.md).

You can also add more training data from other annotations by clicking the `+` button and referencing annotations by ID or WEBKNOSSOS URLs.

### Training Settings

*   **Model Name:** Give your new model a descriptive name.
*   **Comments:** Add any comments or notes about the training for future reference.
*   **Max Distance (nm):** (Only for EM Instances Model) The maximum cross-section length ("diameter") for each identified object in nanometers e.g. Nuclei: 1000nm, Vesicles: 80nm.

### Credit Information

This section provides an overview of your available credits in your organization and the estimated cost for the training. Cost varies depending on the size of your dataset and the type of model you want to train.

## Launching the Training

After configuring everything, you can start the training by clicking the `Start Training` button. You can monitor the progress of your training job from the [`Processing Jobs` page](./jobs.md) or wait for the email notification. Training might take a few hours depending on the size of your dataset.

Once the training is finished, you can find an overview of all your trained models on the `Admin` > `AI Models` page in the navbar. Please refer to the [AI Segmentation](./ai_segmentation.md) guide for more information on how to apply your trained models to your dataset.


<!-- Keep info in sync with docs/automation/ai_segmentation.md -->
!!! info 
    AI Model Training is only available on [webknossos.org](https://webknossos.org) at the moment. 
    If you want to set up on-premise automated analysis at your institute/workplace, then [please contact sales](mailto:sales@webknossos.org). 
