# Registering Layers

If the layers of a dataset don't line up, you can register them to one of them (the *primary* layer) by placing matching landmarks.
The layers that get registered are called *secondary* layers.
WEBKNOSSOS fits an affine transform to the landmark pairs of each secondary layer, shows the result right away and can apply it to the dataset.
Applying transforms the secondary layers to match the primary layer. The primary layer keeps its position.
Tools like elastix and BigWarp call the primary layer *fixed* and the secondary layers *moving*.
The workflow is similar to the [BigWarp](https://imagej.net/plugins/bigwarp) plugin of Fiji.

## Opening the Layer Registration Page

There are several ways to open it. The dataset needs at least two layers.

- In the **Datasets** tab of your dashboard, open the context menu of a dataset (right-click or "…") and choose **Register Layers…**.
- While viewing the dataset, open the "…" menu of a layer in the **Layers** tab of the left sidebar and choose **Register Layers…**. The layer registration page opens in a new tab.
- Use the **Register Layers** button next to the **Transformation Mode** field in the **Data Source** tab of the [dataset settings](./settings.md). The layer registration page opens in a new tab.
- After uploading, adding or composing a dataset with at least two layers, the confirmation dialog links to the layer registration page.

If the layers come from different datasets, [compose](./composing.md) them into one dataset without any transforms first and register the layers afterwards.

The layer registration page lists all layer registrations of the dataset, so you can continue an earlier one instead of starting over.
Each layer registration is stored in its own *layer registration annotation*, which belongs to one primary layer (e.g., "Layer registration to color_1").
It holds the landmarks of all secondary layers, so usually one layer registration per dataset is enough.

- Click **New layer registration** and select the primary layer to start a new one. We recommend the layer that overlaps with the most other layers. The primary layer can't be changed later. If there already is a layer registration to that layer, the dialog offers to continue it instead.
- Click **Open** to continue one of your layer registrations.
- Layer registrations of other users (e.g., shared with your team) can't be edited directly. Use **Copy to my account** to continue working on your own copy.

Layer registration annotations also appear in your list of annotations.
If you own one, opening it there leads to the layer registration view as well, unless it is archived or locked.
Other users who open a shared layer registration annotation see it in the normal annotation view. But sharing from the layer registration view is currently disabled. So it should be impossible (except using scripting) to share a landmark annotation with someone else. Users editing the annotation in the normal annotation view could break assumptions of the annotation like adding a volume annotation layer or breaking the tree group hierarchy.

## Placing Landmarks

The layer registration view shows the primary layer on the left and one secondary layer on the right.
A label in the top left corner of each view names its layer.
Each side shows only its own layer at first.
As soon as a transform is estimated (see below), both views also show the other layer. Press ++x++ to hide it again.

To place landmarks in a view, select the skeleton tool in the toolbar of that view.
Each click with the skeleton tool then places a landmark: a skeleton node in a tree of its own, not connected to any other node.
Apart from that, the skeleton tool works as in a normal annotation and has the same shortcuts, e.g., ++del++ deletes the active node.
See [Skeleton Keyboard Shortcuts](../skeleton_annotation/tools.md#skeleton-keyboard-shortcuts) and [Keyboard & Mouse Shortcuts](../ui/keyboard_shortcuts.md#skeleton-annotation-mode).

The usual workflow to place landmarks is:

1. Find a structure that you can recognize in both layers.
2. Click on it in the left view, then click on the same spot in the right view. Every click creates a new landmark.
3. Repeat this for several structures that are spread over the dataset.

Each landmark belongs to a pair, and both landmarks of a pair have the same name (e.g., "Landmark 3") and color.
A new landmark completes the pair with the lowest number that has a landmark in the other view only.
If there is no such pair, the landmark starts a new pair.
While a view misses landmarks of the other view, a hint in that view shows which landmark your next click places.

If you delete a landmark in one view, its partner in the other view keeps its pair and waits for a new partner.
The other pairs don't change.
To remove a whole pair, use its delete button in the side panel (see below).
This deletes the landmark in each view separately, so undoing it takes one undo in each view.
To correct a landmark, move it like any other skeleton node, e.g., by dragging it with the skeleton tool (see [Skeleton Tool](../skeleton_annotation/tools.md)).
Landmarks without a partner are not used for the transform.
The landmarks are saved automatically. The top of the side panel shows whether they are saved. If there are unsaved changes, click **Save now** to save right away.

## Estimating the Transform

The transform is estimated automatically when you open a layer registration and after every new, moved or deleted landmark.
The secondary layer is then shown transformed in the left view, and the primary layer inversely transformed in the right view.
Each view always shows its own layer untransformed. The transform only moves the other layer.

To check the transform, switch a view between showing the other layer transformed and untransformed: press ++t++ in that view, or use the transform button in its toolbar.
If the other layer is hidden, it is shown again when you switch to the transformed display.
To show or hide the other layer, press ++x++ in that view, or use the eye button in its toolbar.

The **View** button at the bottom of the side panel on the right has the same switches for both views.
If both layers are color layers, you can also switch on **Green / magenta** there.
In a view that shows both layers, the primary layer is then shown in green and the secondary layer in magenta.
Where the layers match, they add up to gray. Structures that don't match show green or magenta edges.
This is especially helpful for grayscale layers.

A transform needs at least four landmark pairs that don't all lie in one plane.
If all landmarks of a view lie in a single slice (e.g., a single z slice, because you placed them all in the XY viewport), three pairs are enough, as long as they do not lie on one line.
The transform is then fitted within that slice. Along the axis of the slice, it scales nothing: if the landmarks of both views lie in one slice, it only shifts the layer by the distance between the two slices, or not at all if they are the same.
The side panel shows a note about this, except for 2D datasets, where all landmarks always lie in one z slice.
To also fit that axis, add landmarks in other slices.

More shortcuts, which work in the view under the mouse pointer (the keyboard button at the bottom of the side panel lists them, too):

- ++x++: show or hide the other layer in this view.
- ++y++: move the other view to the position that corresponds to the position of this view (needs an estimated transform).

The side panel on the right is open when the layer registration view starts. The table button at the right end of the right view's navbar hides and shows it.
From top to bottom, the panel shows:

- The name of the layer registration and whether it is saved. The arrow leads back to the list of layer registrations. The **⋯** menu renames the layer registration, edits its description, and downloads the complete landmark pairs as a BigWarp CSV file or as two NML files, which you can use in the [dataset composition](./composing.md).
- Which secondary layer is registered to the primary layer, and whether the dataset already uses its transform.
- Whether a transform could be estimated, with the number of pairs and their mean error. A **Next** line suggests what to do next, e.g., which landmark still needs a partner, or which pair has a much higher error than the others. **Show it** moves both views there. Warnings explain why landmarks are not used.
- The list of landmark pairs. For each pair, it shows the color of the pair, and how far apart its two landmarks still are after the transform, as a length in the unit of the dataset (e.g., nm). A pair whose error is much higher than that of the others is highlighted, because it was probably placed imprecisely. Use **Sort** to sort the pairs by their error, largest first. Landmarks without a partner are highlighted. Hover over a color to see the coordinates; in a wide panel, the coordinates are shown directly.
- At the bottom: the **View** settings, the keyboard shortcuts, and **Apply to dataset…**.

Click a pair to select its landmarks in both views and move both views to them.

## Registering More Than Two Layers

If the dataset has more than two layers, the secondary layer at the top of the side panel is a selection.
Its list shows, for each secondary layer, how many landmark pairs it has, their mean error, and whether the dataset already uses its transform.
Choose a layer to show it in the right view. The landmarks are saved first, and both views are loaded again.
When the transform of a layer is applied, the **Next** line points to the next layer that still needs landmarks.
Each secondary layer has its own landmarks, also in the left view, so a structure that you can't see in one secondary layer doesn't get in the way of another.

To see all layers transformed at once, show the other secondary layers in the layer settings of the left view (left sidebar).
They are shown with the transforms estimated from their landmarks.

If a secondary layer has no landmarks yet, the side panel offers to start with the landmarks that the primary layer has for another secondary layer.
After copying them, the right view asks for the matching spot of each landmark, one after the other.
Delete the landmarks that you can't find in the new secondary layer.

## Applying the Transforms to the Dataset

Click **Apply to dataset…** in the side panel to store the estimated transforms as the transforms of the secondary layers.
The dialog lists what happens to each secondary layer: layers with enough landmark pairs get their new transform, the others stay unchanged.
Applying only changes the transforms in the dataset settings. The image data is not copied or changed, so this takes effect right away for everyone who views the dataset.
You can change or remove the transforms later in the dataset settings, or apply new ones here.
Applying replaces the transforms that the secondary layers had before, and there is no undo button. It requires the right to edit the dataset.
If the primary layer already has transforms, the applied transforms build on them, and changing them later makes the applied transforms outdated.

The layer registration view itself ignores the transforms that the dataset stores, so the landmarks and the preview don't depend on transforms that were applied before.
