# Sharing
webKnossos is built for working collaboratively and sharing your work with the community. wK can share both skeleton annotations of large structures and pure datasets & segmentations for showcasing the raw data. The sharing methods discussed here refer to sharing scenarios with colleagues, reviewers, and publishers outside of your wK organization or your lab.

To manage access right to certain dataset for wK users check out the [datasets guide](./datasets.md#dataset-permissions).

## Dataset Sharing

Dataset sharing allows outsider users to view your datasets and segmentation layers within webKnossos. Shared resources can be accessed the through direct URL or can be featured on a spotlight gallery for showcasing your work.

Sharing a dataset is useful for few scenarios: 
- You recorded a novel microscopy dataset and want to include links to it in your paper or for reviewers.
- You created an interesting, highly-accurate segmentation layer for an existing dataset and want to share it for your publication.
- You have worked and published several datasets over the years and want to have a single gallery for all you public datasets.

webKnossos share datasets publicly (everyone can view them without any login) or privately (a login is required to view the link).

### Private Sharing for Review
A privately shared dataset can only be accessed from outside your using the correct URL. A unique authentification token is part of the URL so anyone with this URL has access rights for viewing the dataset. The dataset is NOT featured publicly anywhere else on your wK instance. 

Private sharing is extremely useful for giving outsiders (reviewers, publishers, journalists, etc) an opportunity to look at your data without having to publish it publicly. 

To share a dataset privately, follow these steps:
1. Navigate to your user dashboard and `Datasets`. 
2. Select the dataset that you want to share and click on `Edit.
3. Under the `General`tab, scroll down to the `Sharing Link` and copy it. That's all you need to do.

To revoke a sharing link in the future, click the `Revoke` button to the right-hand side of the link.

{% hint style='danger' %}
Do not enable the `Make dataset publicly accessible` checkbox or otherwise, your dataset will be featured on the front page of your wK instance. Public access rights are not required for private sharing.
{% endhint %}

### Public Sharing
Public sharing is akin to publishing your data. Anyone can access the shared dataset and view it on your wk instance without the need for an account. Further, publicly share datasets are promoted in a dataset gallery on your wK start page for logged-out users. Alternatively, navigate to `http://<wk-url>/spotlight`.

Public datasets provide an easy and convenient way of sharing your data with outsiders after you have successfully published them. Outside user can navigate your data from the comfort of their own browser. 

To share a dataset publicly, follow these steps:
1. Navigate to your user dashboard and `Datasets`. 
2. Select the dataset that you want to share and click on `Edit.
3. Under the `General`tab, scroll down to the checkbox `Make dataset publicly accessible` and enable it. On the same screen, you can add/edit a dataset's description and give it more appropriate tile (`Display name`). That's all you need to do.

To obtain a link to a particular dataset, navigate to a dataset either from the spotlight gallery or your user dashboard by clicking `View`. After wK has finished loading the data, you can copy the URL from your browser window for sharing.

{% hint style='info' %}
We recommend giving your datasets a meaningful description and display name. Both are featured next to a preview of the dataset in the gallery of featured public datasets. 
{% endhint %}


## Tracing Sharing
- from within the tracing view
- public vs private
- requires the dataset to be publicly shared
- copy to my account


