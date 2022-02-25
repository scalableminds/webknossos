# Automated Analysis

While webKnossos is great for manual annotation, some datasets are either too big to do by hand or you need results quicker. webKnossos contains early access to automated analysis using machine learning classifiers for dataset segmentations. The webKnossos developer team has many years of experience with training ML models for large-scale data analysis outside of webKnossos. We aim to bring some of this know-how directly into webKnossos itself.

The automated analysis features are designed to provide a general solution to a wide range of (EM) datasets. Since datasets differ in staining protocols, imaging modalities, imaging resolution & fidelity, your results may vary. [Please contact us](mailto:hello@webknossos.org) for customized, fine-tuned solutions for your dataset. 

We plan to add more automated analysis features in the future. If you want to work with us on an automated analysis project, [please contact us](mailto:hello@webknossos.org). 
We would love to integrate analysis solutions for more modalities and use cases.

Automated analysis is only available on [webKnossos.org](https://webknossos.org) at the moment. 
If you want to set up on-premise automated analysis at your institute/workplace, then [please contact us](mailto:hello@webknossos.org). 

## Nuclei Inferral
As a first trial, webKnossos includes nuclei segmentation. This analysis is designed to work with serial block-face electron microscopy (SBEM) data of neural tissue (brain/cortex) and will find and segment all nuclei within the dataset.

You can launch the nuclei inferral from the `Info` tab in the right-hand side panel. Use the `Process Dataset` link to start the analysis.

Computation time for this analysis depends directly on the size of your dataset. 
Expect a few hours for medium-sized volumetric EM datasets. 
The finished analysis will be available as a new dataset from your dashboard. You can monitor the status and progress of the analysis job from the `Processing Jobs` section of the `Administration` menu at the top of the screen.

/todo add screenshot of nuclei classification
/todo add screenshot of jobs list

## Custom Analysis
At the moment, webKnossos can not be used to train a custom classifier itself. This might be something that we add in the future if there is enough interest in this.

If you are interested in specialized, automated analysis, image segmentation, object detection etc. than feel to [contact us](mailto:hello@webknossos.org). The webKnossos development teams offers [commercial analysis services for](https://webknossos.org/services/automated-segmentation) that. 