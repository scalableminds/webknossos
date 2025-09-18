# AI Model Training

WEBKNOSSOS allows you to train your own AI models for image segmentation. This feature is currently in early access.

!!!info
    AI Model Training is only available on [webknossos.org](https://webknossos.org) at the moment. 
    If you want to set up on-premise automated analysis at your institute/workplace, then [please contact sales](mailto:sales@webknossos.org). 

To start a training, click on the `AI Analysis` button in the toolbar and select `Train AI model` from the dropdown menu.

This will open a dialog where you can configure and start your training job.

## Preparing Your Annotations

Before you can start a training, you need to prepare your annotations. The training process requires at least one volume annotation with at least one bounding box.

Here is a step-by-step guide to prepare your data:

1.  **Create an annotation:** Start by creating a new annotation or opening an existing one.
2.  **Create a volume annotation:** Use the volume annotation tool to create a segmentation of your structures of interest. This will be your ground truth data.
3.  **Define bounding boxes:** Create one or more bounding boxes that define the areas you want to use for training. 
    - It is important that the bounding boxes are not too small. The validation code checks that each bounding box has a minimum extent of **32 voxels in each dimension**.
    - Bounding boxes that are not aligned with the selected magnification will be automatically shrunk to fit.
    - For optimal training, all bounding boxes should have dimensions that are multiples of the smallest box dimensions.

## Launching the Training

Once your annotations are ready, you can launch the training from the `Train AI model` dialog.

### Select AI Training Task

First, you need to select the type of model you want to train:

*   **EM Neuron Model:** Train a new AI model for EM neuron segmentation. This is optimized for dense neuronal tissue from SEM, FIB-SEM, SBEM, and Multi-SEM microscopes.
*   **EM Instances Model:** Train a new AI model for EM instance segmentation. This is optimized for nuclei, mitochondria, and other cell types.

### Training Data

In this section, you need to specify the data that will be used for training.

*   **Image Data Layer:** Select the raw image layer.
*   **Ground Truth Layer:** Select the segmentation layer that you created.
*   **Magnification:** Choose the magnification at which the training should be performed.

You can also add more training data from other annotations by clicking the `+` button and adding annotation IDs or URLs.

### Training Settings

*   **Model Name:** Give your new model a descriptive name.
*   **Comments:** Add any comments or notes about the training.
*   **Max Distance (nm):** (Only for EM Instances Model) This parameter defines the maximum distance in nanometers for two objects to be considered the same instance.

### Credit Information

This section provides an overview of your available credits and the estimated cost for the training.

After configuring everything, you can start the training by clicking the `Start Training` button. You can monitor the progress of your training job from the `Processing Jobs` page.
