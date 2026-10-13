# Registering Layers

If the layers of a dataset don't line up, you can register them to one of them (the *fixed* layer) by placing matching landmarks.
The layers that get registered are called *moving* layers.
WEBKNOSSOS fits an affine transform to the landmark pairs of each moving layer, shows the result right away and can apply it to the dataset.
The workflow is similar to the [BigWarp](https://imagej.net/plugins/bigwarp) plugin of Fiji.

## Opening the Layer Registration Page

In the **Datasets** tab of your dashboard, open the context menu of a dataset (right-click or "…") and choose **Register Layers…**.
You can also use the **Register Layers…** button in the **Data Source** tab of the [dataset settings](./settings.md).
The dataset needs at least two layers.

The layer registration page lists the existing layer registrations of the dataset, so you can continue an earlier one instead of starting over.
Each layer registration is stored in its own *layer registration annotation*, which belongs to one fixed layer (e.g., "Layer registration to color_1").
It holds the landmarks of all moving layers.

- Select a fixed layer to see only the layer registrations to that layer.
- Click **Create new layer registration** to start a new one for the selected layer.
- Click **Open** to continue one of your layer registrations.
- Layer registrations of other users (e.g., shared with your team) can't be edited directly. Use **Copy to my account** to continue working on your own copy.

Layer registration annotations also appear in your list of annotations. Opening one there leads to the layer registration view as well.

## Placing Landmarks

The layer registration view shows the fixed layer on the left and one moving layer on the right.
Each side shows only its own layer at first.
As soon as a transform is estimated (see below), both views also show the other layer. Press **x** to hide it again.

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
Landmarks without a partner are not used for the transform.
The landmarks are saved automatically. Use the save button at the top of the side panel to save right away.

## Estimating the Transform

The transform is estimated automatically when you open a layer registration and after every new, moved or deleted landmark.
The moving layer is then shown transformed in the left view, and the fixed layer inversely transformed in the right view.
Each view always shows its own layer untransformed. The transform only moves the other layer.

To check the transform, switch a view between showing the other layer transformed and untransformed: press **t** in that view, or use the transform button in its toolbar.
If the other layer is hidden, it is shown again when you switch to the transformed display.

If both layers are color layers, you can switch on **Color the layers green and magenta** in the side panel.
In a view that shows both layers, the fixed layer is then shown in green and the moving layer in magenta.
Where the layers match, they add up to gray. Structures that don't match show green or magenta edges.
This is especially helpful for grayscale layers.

A transform needs at least four landmark pairs that don't all lie in one plane.
If all landmarks lie in a single z slice, three pairs are enough. WEBKNOSSOS then assumes that the two layers are only shifted against each other along z.

More shortcuts, which work in the view under the mouse pointer:

- **x**: show or hide the other layer in this view.
- **y**: move the other view to the position that corresponds to the position of this view (needs an estimated transform).

The side panel on the right is open when the layer registration view starts. The table button at the right end of the right view's navbar hides and shows it. A link at the top of the panel leads back to the list of layer registrations. The panel shows whether a transform could be estimated, lets you choose for each view whether it shows the other layer and whether that layer is transformed, and lists all landmark pairs.
For each pair, the list shows how far apart its two landmarks still are after the transform, as a length in the unit of the dataset (e.g., nm). A pair whose error is much higher than that of the others is highlighted, because it was probably placed imprecisely.
The list also shows the number and color of each pair and the coordinates of both landmarks. Landmarks without a partner are highlighted.
Click a pair to select its landmarks in both views and move both views to them.
The download button saves the complete pairs as a BigWarp CSV file or as two NML files, which you can use in the [dataset composition](./composing.md).
The name and description of the layer registration can be edited at the top of the side panel.

## Registering More Than Two Layers

If the dataset has more than two layers, the side panel lists all moving layers under **Layers**.
Each row shows how many landmark pairs the layer has, their mean error, and whether the dataset already uses the transform of that layer.
Click a layer to show it in the right view. The landmarks are saved first, and both views are loaded again.
Each moving layer has its own landmarks, also in the left view, so a structure that you can't see in one moving layer doesn't get in the way of another.

To see all layers transformed at once, show the other moving layers in the layer settings of the left view (left sidebar).
They are shown with the transforms estimated from their landmarks.

If a moving layer has no landmarks yet, the side panel offers to start with the landmarks that the fixed layer has for another moving layer.
After copying them, the right view asks for the matching spot of each landmark, one after the other.
Delete the landmarks that you can't find in the new moving layer.

## Applying the Transforms to the Dataset

Click **Apply to dataset…** in the side panel to store the estimated transforms as the transforms of the moving layers.
The dialog lists what happens to each moving layer: layers with enough landmark pairs get their new transform, the others stay unchanged.
This replaces the transforms that the moving layers had before. It requires the right to edit the dataset.
If the fixed layer already has transforms, the applied transforms build on them, and changing them later makes the applied transforms outdated.

The layer registration view itself ignores the transforms that the dataset stores, so the landmarks and the preview don't depend on transforms that were applied before.
