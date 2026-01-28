# AI Segmentation

While WEBKNOSSOS is great for manual annotation, some datasets are either too big to do by hand or you need results quicker. WEBKNOSSOS contains early access to automated analysis using machine learning classifiers for dataset segmentations. The WEBKNOSSOS developer team has many years of experience with training AI models for large-scale data analysis outside of WEBKNOSSOS. We aim to bring some of this know-how directly into WEBKNOSSOS itself.

The automated analysis features are designed to provide a general solution to a wide range of (EM) datasets. Since datasets differ in staining protocols, imaging modalities, imaging resolution & fidelity, your results may vary. [Please contact us](mailto:hello@webknossos.org) for customized, fine-tuned solutions for your dataset. 

You can launch the AI analysis dialog using the `AI Analysis` button in the toolbar at the top. This will open a dropdown menu with three options:

- **Run AI model:** Run pre-trained or custom AI models on your dataset.
- **Train AI model:** Train your own AI models on your WEBKNOSSOS annotations to match your specific needs. Read more about [training](./ai_training.md).
- **AI Alignment:** Align datasets. Read more about [image alignment](./alignment.md).


## Pre-trained Models

WEBKNOSSOS offers several pre-trained models to get you started quickly:

*   **Neuron Segmentation:** This analysis is designed to work with serial electron microscopy data of neural tissue (brain/cortex) and will segment all neurons within the dataset. It is tuned for serial block-face electron microscopy (SBEM), MultiSEM and focused ion beam-SEM (FIB-SEM) data.
*   **Mitochondria Detection:** Run a pre-trained instance segmentation model for mitochondria detection. Optimized for EM data. Powered by [MitoNet (Conrad & Narayan 2022)](https://volume-em.github.io/empanada).
*   **Nuclei Detection:** (Coming Soon) Run a pre-trained instance segmentation model for nuclei detection. Optimized for EM data.

## Your Custom Models

This section will list any custom models that you have trained or uploaded to your organization. While these build on the foundation of our pre-trained models, you can customize your models to identify or segment biological structures of your interest or fine-tune models to the contrast and staining of your images. Training will be enabled soon.

## Analysis Settings

Before starting the analysis, you need to configure the following settings:

*   **New Dataset Name:** The name of the new dataset that will be created with the segmentation results.
*   **Image Data Layer:** The image layer from your current dataset that the model will use for analysis.
*   **Bounding Box:** The region of interest that you want to analyze. You can choose to analyze the full dataset or a specific bounding box that you have created. Read more about [choosing bounding boxes](./choosing_bounding_boxes.md).

You can also access **Advanced Settings** to further customize the analysis.

## Credit Information

This section provides an overview of your available credits in your organization and the estimated cost for the analysis. Cost varies depending on the size of your dataset and the type of model you want to run.

---

Computation time for any analysis depends directly on the size of your dataset. 
Expect a few hours for medium-sized volumetric EM datasets. 
The finished analysis will be available as a new dataset from your dashboard. You can monitor the status and progress of the analysis job from the [`Processing Jobs` page](./jobs.md) or wait for the email notification.


We plan to add more AI analysis features in the future. If you want to work with us on an automated analysis project, [please contact us](mailto:hello@webknossos.org). 
We would love to integrate analysis solutions for more modalities and use cases.

<!-- Keep info in sync with docs/automation/ai_training.md -->
!!! info 
    Automated analysis is only available on [webknossos.org](https://webknossos.org) at the moment. 
    If you want to set up on-premise automated analysis at your institute/workplace, then [please contact sales](mailto:sales@webknossos.org). 
