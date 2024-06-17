# Collaboration & Sharing

WEBKNOSSOS is built for working collaboratively and sharing your work with colleagues, collaborators, and the scientific community.
Anything in WEBKNOSSOS can be shared: the raw datasets, any skeleton or volume annotations, or complex segmentations.

When speaking about collaboration and sharing, we imagine three scenarios supported by WEBKNOSSOS:

1. Sharing data with outsiders - anyone who is not a member of your WEBKNOSSOS organization, e.g., colleagues from other institutes, reviewers, publishers, a paper publication, and the research community as a whole (read-only).
2. Sharing data within your organization to collaborate with other members/co-workers (both read-only or modifiable)
3. Reconstruction of large datasets through a divide-and-conquer strategy with the [projects and tasks system](./tasks.md).

Since WEBKNOSSOS is a web platform, most resources can be shared as a web link/URL. This makes it super easy to integrate WEBKNOSSOS in your existing communication workflows, e.g.:

- send collaborators an _email_ containing a link to specific, interesting data locations or annotations
- include a link in a _publication_ so readers can have direct access to the data to see for themselves
- share a link through _Slack_, _MS Teams_, or any other messenger service
- include it in any _lab journal_ and _blog_ posts
- link it in a _forum_ post

In many ways, sharing by web link works similarly to products like Google Drive or Dropbox.

WEBKNOSSOS sharing is tightly integrated with user permissions and access rights. See the sections [on dataset management](./datasets.md#general) and [user administration](./users.md) for more info.

![youtube-video](https://www.youtube.com/embed/hcm8Jx22DG8)

## Dataset Sharing

Dataset sharing allows outside users to view your datasets and segmentation layers within WEBKNOSSOS.
Shared resources can be accessed through a direct URL or can be featured.
[Please contact us](mailto:hello@webknossos.org) to feature your dataset on https://webknossos.org.

The easiest way to obtain this sharing link is by clicking the `Share` button in the toolbar at the top of the screen next to the position/coordinate section (_Share icon_).
The sharing link also encodes additional information, such as your current camera position/rotation, zoom level, any layers that are turned on/off, the selected node, etc ([Details below](#sharing_link_format). In other words, a sharing link typically captures your current WEBKNOSSOS state so that any recipient can take off from the same situation.

Sharing a dataset is useful for multiple scenarios:

- You recorded a novel microscopy dataset and want to include links to it in your paper or for reviewers. Use wklink.org to shorten these URLs, e.g. https://wklink.org/5386 ([contact us](mailto:hello@webknossos.org)) to create these short links.
- You created an interesting, highly-accurate segmentation layer for an existing dataset and want to share it for your publication.
- You have worked and published several datasets over the years and want to have a single gallery for all your public datasets.

WEBKNOSSOS shares datasets publicly (everyone can view them without any login) or privately (a login or special URLs are required to view the link).

### Private and Internal Sharing

A privately shared dataset can only be accessed by outside users using the correct URL.
A unique authentication token is part of the URL, so anyone with this URL has access permission for viewing the dataset.
The dataset is NOT featured publicly anywhere else on your WEBKNOSSOS instance.

Private sharing is useful for giving outside users (reviewers, editors, journalists etc.) an opportunity to look at your data without having to publish it publicly.

To share a dataset privately, follow these steps:

1. Navigate to your user dashboard and `Datasets`.
2. Select the dataset that you want to share and click on `Settings`.
3. Under the `Sharing & Permissions` tab, scroll down to the `Sharing Link` and copy it.

![Configure the Dataset Sharing](images/dataset_general.jpeg)

To revoke a sharing link in the future, click the `Revoke` button on the right-hand side of the link.

**Do not enable the `Make dataset publicly accessible` checkbox otherwise, anyone with a link can access this dataset without needing to log in/authenticate.
Public access rights are not required for private sharing.**

### Public Sharing

Public sharing provides access to your dataset to the general public.
Anyone can access the shared dataset and view it on your WEBKNOSSOS instance without the need for an account.

![The Featured Publications tab provides a public showcase of selected published, community datasets. ](images/getting_started-datasets.jpeg)

Public datasets provide an easy and convenient way of sharing your data with outside users after you have successfully published them.
Outside users can explore your data from the comfort of their browser without needing to sign up for an account.

To share a dataset publicly, follow these steps:

1. Navigate to your user dashboard and `Datasets`.
2. Select the dataset that you want to share and click on `Settings`.
3. Under the `Sharing & Permissions` tab, scroll down to the checkbox `Make dataset publicly accessible` and enable it.
4. Copy the sharing link and distribute it to your colleagues through email, social media, messengers, etc.
5. (Recommended. From the `Metadata` tab, add/edit the dataset's description and give it a more appropriate title (`Display name`)).

![The Metadata tab overview](images/metadata_tab.jpeg)

**We recommend giving your datasets a meaningful display name and description. Both are featured next to the data viewport in the `Info` tab in the main WEBKNOSSOS UI.**

## Annotation Sharing

Besides sharing just a dataset for viewing, WEBKNOSSOS can also share complete annotations, e.g., a large-scale skeleton reconstruction.
Sharing works for both skeletons and volume annotations.

### Annotation Permissions

There are three options to control who can see an annotation if they know the annotation URL:

1. `Private`: Only you and your team manager have access to the annotation.
2. `Internal`: All members of your organization have access to the annotation. Default option.
3. `Public`: Everybody, regardless of their login status, can access this annotation.
4. (`Team Sharing`: Share this annotation with other organization members so that it appears on their dashboard in the `Annotations` tab)

To change the visibility of an annotation, follow these steps:

1. Open your annotation from the dashboard
2. From the [toolbar](./tracing_ui.md#the-toolbar) select `Share` from the overflow menu next to the `Save` button.
3. Select the desired permission level from the three available options.

![Configure the Annotation Permissions](images/sharing_modal_visibility.jpeg)

Additionally, you can control whether other users, who can see your annotation, may also edit your annotation.
Use this setting to enable collaborative work within your annotation.
However, note that you should coordinate the collaboration because parallel changes to an annotation are not supported.
To avoid possible conflicts in such cases the annotation will be locked to a single user at a time. In case the annotation is locked by someone else WEBKNOSSOS will tell you the name of the person currently editing so you can coordinate with this person.

### Link Sharing

Annotations can be shared via a link. People, who obtain the link, must have access to the annotation according to the permissions above to view the annotation.

`Public` annotations do not require any user authentication and are a great option for sharing a link to your annotation from social media or your website.
For public annotations to work properly, the underlying dataset must also be shared publicly or privately (via token URL).
Otherwise, the annotation and data cannot be loaded by WEBKNOSSOS, and an error will occur.
[Learn how to share datasets publicly above.](#public-sharing)

`Internal` annotations require the recipient of a link to log in with his WEBKNOSSOS account.
This is primarily used for sharing annotations with your co-workers, e.g. for highlighting interesting positions in your work.
Since your position, rotation, zoom etc. are encoded in the URL it is a great way for working collaboratively.
Just send an URL to your co-workers in an email or blog post, and they may jump right into the annotation at your location.

`Private` annotations don't allow sharing. However, your direct supervisor and admins can still view the annotation.

Since every annotation is tied to an individual WEBKNOSSOS user, co-workers cannot modify your annotation if you share it with them.
Instead, the shared annotation will be read-only.
If your co-workers want to make modifications to the annotation, they can click the `Copy to my Account` button in the toolbar.
This will create a copy of the annotation, link it to the co-workers' accounts and enable modifications again.
Think of this feature as GitHub forks. Changes made to a copy are not automatically synced with the original.

To get the sharing link of an annotation, follow the same steps as for changing the viewing permissions:

1. Open your annotation
2. From the [toolbar](./tracing_ui.md#the-toolbar) select `Share` from the overflow menu next to the `Save` button.
3. Copy the sharing URL.

![Get the Annotation Sharing Link](images/sharing_modal_link.jpeg)

#### Sharing Link Format

By default, WEBKNOSSOS shortens the web links for ease of use. You can switch to full-length links in the link-sharing UI.

As mentioned above, the sharing link encodes certain properties, like the current position, rotation, zoom, active mapping, and visible meshes.
Anyone who opens a link will have the same WEBKNOSSOS experience that was captured when copying the link.
Alternatively, the link can be crafted manually or programmatically to direct users to specific locations in a dataset.

The information is JSON-encoded in the URL fragment and has the following format (flow type definition):

<details>
  <summary>URL Fragment Format</summary>
  
  ```javascript
  type MappingType = "JSON" | "HDF5";
  type ViewMode = "orthogonal" | "oblique" | "flight" | "volume";
  type Vector3 = [number, number, number];
  // For datasets with more than 3 dimensions
  type AdditionalCoordinate = { name: string; value: number };

  type BaseMeshUrlDescriptor = {|
    +segmentId: number,
    +seedPosition: Vector3,
    +seedAdditionalCoordinates?: AdditionalCoordinate[];
  |};
  type AdHocMeshUrlDescriptor = {|
    ...BaseMeshUrlDescriptor,
    +isPrecomputed: false,
    mappingName: ?string,
    mappingType: ?MappingType,
  |};
  type PrecomputedMeshUrlDescriptor = {|
    ...BaseMeshUrlDescriptor,
    +isPrecomputed: true,
    meshFileName: string,
  |};
  type MeshUrlDescriptor = AdHocMeshUrlDescriptor | PrecomputedMeshUrlDescriptor;

  type UrlStateByLayer = {
    [layerName: string]: {
      meshInfo?: {
        meshFileName: ?string,
        meshes: Array<MeshUrlDescriptor>,
      },
      mappingInfo?: {
        mappingName: string,
        mappingType: MappingType,
        agglomerateIdsToImport?: Array<number>,
      },
      connectomeInfo?: {
        connectomeName: string,
        agglomerateIdsToImport?: Array<number>,
      },
      isDisabled?: boolean,
    },
  };

  type UrlManagerState = {|
    position?: Vector3,
    mode?: ViewMode,
    zoomStep?: number,
    activeNode?: number,
    rotation?: Vector3,
    stateByLayer?: UrlStateByLayer,
    additionalCoordinates?: AdditionalCoordinate[];
  |};

  ```
</details>


To avoid having to create annotations in advance when programmatically crafting links, a sandbox annotation can be used. A sandbox annotation is always accessible through the same URL and offers all available annotation features, however, changes are not saved. At any point, users can decide to copy the current state to their account. The sandbox can be accessed at `<webknossos_host>/datasets/<organization>/<dataset>/sandbox/skeleton`.

### Team Sharing & Collaboration
In addition to sharing your annotation via a link, you can also share your annotations with colleagues and make them available on their dashboard from the `Annotations` tab.
This is the simplest way to share an annotation with a whole team both for review purposes (read-only) or collaborative work efforts on the same annotation by several people.

To share an annotation with a certain team, follow these steps:

1. Open your annotation
2. From the [toolbar](./tracing_ui.md#the-toolbar) select `Share` from the overflow menu next to the `Save` button.
3. Under *Team Sharing*, select the teams from the dropdown menu.

![Enable Team Sharing for your annotation](images/sharing_modal_team.jpeg)

Any annotation shared this way will be listed in your personal and any team member's [Annotations Dashboard Tab](./dashboard.md#shared-annotations). By default team sharing is read-only, i.e. other team members can not make modifications to your annotation.

To collaboratively work on the same annotation with multiple users from your team, you can share an annotation and allow modifications. Select "Yes, allow editing" from the sharing UI.

Note that while WEBKNOSSOS allows several people to make modifications to a single annotation, it is strongly advised that only one person works on an annotation at once.
WEBKNOSSOS does not yet resolve changes made by multiple people annotating simultaneously and this may lead to data loss or inconsistencies.
Please coordinate accordingly with your collaborators. We aim to improve this aspect in the future.

!!! info
    In addition to the integrated Sharing features, you can also [download annotations](./export.md) and send them via email to collaborators.
