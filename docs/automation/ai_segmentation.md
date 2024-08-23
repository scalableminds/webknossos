# AI Segmentation

TODO add intro
TODO add mito<>
TODO add custom classification
TODO revise custom analysis; advertise commercial services

## Neuron Segmentation
As a first trial, WEBKNOSSOS includes neuron segmentation. This analysis is designed to work with serial block-face electron microscopy (SBEM) data of neural tissue (brain/cortex) and will segment all neurons within the dataset.

You can launch the AI analysis modal using the `AI Analysis` button in the toolbar at the top. Use the `Start AI neuron segmentation` button in the modal to start the analysis.

![Neuron segmentations can be launched from the tool bar.](images/process_dataset.jpg)

Computation time for this analysis depends directly on the size of your dataset. 
Expect a few hours for medium-sized volumetric EM datasets. 
The finished analysis will be available as a new dataset from your dashboard. You can monitor the status and progress of the analysis job from the [`Processing Jobs` page](./jobs.md) or wait for the email notification.

![Starting a new neuron segmentation.](images/neuron_segmentation_start.jpeg)
![Monitor the segmentation progress from the Jobs page.](images/nuclei_segmentation_job.jpeg)

## Custom Analysis
At the moment, WEBKNOSSOS can not be used to train custom classifiers. This might be something that we add in the future if there is enough interest in this.

If you are interested in specialized, automated analysis, image segmentation, object detection etc. then feel free to [contact us](mailto:hello@webknossos.org). The WEBKNOSSOS development teams offers [commercial analysis services](https://webknossos.org/services/automated-segmentation) for that. 