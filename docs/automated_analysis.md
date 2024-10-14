# Automated Analysis

While WEBKNOSSOS is great for manual annotation, some datasets are either too big to do by hand or you need results quicker. WEBKNOSSOS contains early access to automated analysis, including machine learning classifiers for dataset segmentations. The WEBKNOSSOS developer team has many years of experience with training AI models for large-scale data analysis outside of WEBKNOSSOS. We aim to bring some of this know-how directly into WEBKNOSSOS itself.

The automated analysis features are designed to provide a general solution to a wide range of (EM) datasets. Since datasets differ in staining protocols, imaging modalities, imaging resolution & fidelity, your results may vary. [Please contact us](mailto:hello@webknossos.org) for customized, fine-tuned solutions for your dataset. 

We plan to add more automated analysis features in the future. If you want to work with us on an automated analysis project, [please contact us](mailto:hello@webknossos.org). 
We would love to integrate analysis solutions for more modalities and use cases.

!!!info
    Automated analysis is only available on [webknossos.org](https://webknossos.org) at the moment. 
    If you want to set up on-premise automated analysis at your institute/workplace, then [please contact sales](mailto:sales@webknossos.org). 

## Neuron Segmentation
As a first trial, WEBKNOSSOS includes neuron segmentation. This analysis is designed to work with serial block-face electron microscopy (SBEM) data of neural tissue (brain/cortex) and will segment all neurons within the dataset.

You can launch the AI analysis modal using the `AI Analysis` button in the toolbar at the top. Use the `Start AI neuron segmentation` button in the modal to start the analysis.

![Neuron segmentations can be launched from the tool bar.](images/process_dataset.jpg)

Computation time for this analysis depends directly on the size of your dataset. 
Expect a few hours for medium-sized volumetric EM datasets. 
The finished analysis will be available as a new dataset from your dashboard. You can monitor the status and progress of the analysis job from the [`Processing Jobs` page](./jobs.md) or wait for the email notification.

![Starting a new neuron segmentation.](images/neuron_segmentation_start.jpeg)
![Monitor the segmentation progress from the Jobs page.](images/nuclei_segmentation_job.jpeg)

## Alignment (Image Registration)
For single-tile image stacks, an alignment is directly possible from within WEBKNOSSOS.
Simply upload the dataset, open it and select the "Alignment" tab in the AI Analysis dialog.

You can even annotate landmarks with the skeleton tool and use that to let WEBKNOSSOS align the dataset. Often these landmarks are not necessary, but for particularly hard to align sections, they can be quite useful. When manual landmarks are used, they don't need to cover the entire dataset.

For multi-tile image stacks, please refer to our [Alignment services](https://webknossos.org/services/alignment).

## Custom Analysis
At the moment, WEBKNOSSOS can not be used to train custom classifiers. This might be something that we add in the future if there is enough interest in this.

If you are interested in specialized, automated analysis, image segmentation, object detection etc. then feel free to [contact us](mailto:hello@webknossos.org). The WEBKNOSSOS development teams offers [commercial analysis services](https://webknossos.org/services/automated-segmentation) for that. 
