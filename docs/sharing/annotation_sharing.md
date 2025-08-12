# Annotation Sharing

Besides sharing just a dataset for viewing, WEBKNOSSOS can also share complete annotations, e.g., a large-scale skeleton reconstruction.
Sharing works for both skeletons and volume annotations.

## Annotation Permissions

There are three options to control who can see an annotation if they know the annotation URL:

1. `Private`: Only you and your team manager have access to the annotation.
2. `Internal`: All members of your organization have access to the annotation. Default option.
3. `Public`: Everybody, regardless of their login status, can access this annotation.
4. (`Team Sharing`: Share this annotation with other organization members so that it appears on their dashboard in the `Annotations` tab)

To change the visibility of an annotation, follow these steps:

1. Open your annotation from the dashboard
2. From the [toolbar](../ui/toolbar.md) select `Share` from the overflow menu next to the `Save` button.
3. Select the desired permission level from the three available options.

![Configure the Annotation Permissions](../images/sharing_modal_visibility.jpeg)

Additionally, you can control whether other users, who can see your annotation, may also edit your annotation.
Use this setting to enable collaborative work within your annotation.
However, note that you should coordinate the collaboration because parallel changes to an annotation are not supported.
To avoid possible conflicts in such cases the annotation will be locked to a single user at a time. In case the annotation is locked by someone else WEBKNOSSOS will tell you the name of the person currently editing so you can coordinate with this person.

## Link Sharing

Annotations can be shared via a link. People, who obtain the link, must have access to the annotation according to the permissions above to view the annotation.

`Public` annotations do not require any user authentication and are a great option for sharing a link to your annotation from social media or your website.
For public annotations to work properly, the underlying dataset must also be shared publicly or privately (via token URL).
Otherwise, the annotation and data cannot be loaded by WEBKNOSSOS, and an error will occur.
[Learn how to share datasets publicly.](./dataset_sharing.md#public-sharing)

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
2. From the [toolbar](../ui/toolbar.md) select `Share` from the overflow menu next to the `Save` button.
3. Copy the sharing URL.

![Get the Annotation Sharing Link](../images/sharing_modal_link.jpeg)

### Sharing Link Format

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
    nativelyRenderedLayerName?: string | null;
  |};

  ```
</details>


To avoid having to create annotations in advance when programmatically crafting links, a sandbox annotation can be used. A sandbox annotation is always accessible through the same URL and offers all available annotation features, however, changes are not saved. At any point, users can decide to copy the current state to their account. The sandbox can be accessed at `<webknossos_host>/datasets/<organization>/<dataset>/sandbox/skeleton`.

## Team Sharing & Collaboration
In addition to sharing your annotation via a link, you can also share your annotations with colleagues and make them available on their dashboard from the `Annotations` tab.
This is the simplest way to share an annotation with a whole team both for review purposes (read-only) or collaborative work efforts on the same annotation by several people.

To share an annotation with a certain team, follow these steps:

1. Open your annotation
2. From the [toolbar](../ui/toolbar.md) select `Share` from the overflow menu next to the `Save` button.
3. Under *Team Sharing*, select the teams from the dropdown menu.

![Enable Team Sharing for your annotation](../images/sharing_modal_team.jpeg)

Any annotation shared this way will be listed in your personal and any team member's [Annotations Dashboard Tab](../dashboard/annotations.md). By default team sharing is read-only, i.e. other team members can not make modifications to your annotation.

To collaboratively work on the same annotation with multiple users from your team, you can share an annotation and allow modifications. Select "Yes, allow editing" from the sharing UI.

Note that while WEBKNOSSOS allows several people to make modifications to a single annotation, it is strongly advised that only one person works on an annotation at once.
WEBKNOSSOS does not yet resolve changes made by multiple people annotating simultaneously and this may lead to data loss or inconsistencies.
Please coordinate accordingly with your collaborators. We aim to improve this aspect in the future.

!!! info
    In addition to the integrated Sharing features, you can also [download annotations](../volume_annotation/import_export.md) and send them via email to collaborators.
