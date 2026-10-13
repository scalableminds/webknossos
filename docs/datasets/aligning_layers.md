# Aligning Layers

If two layers of a dataset don't line up, you can align one of them (the *moving* layer) to the other (the *fixed* layer) by placing matching landmarks in both layers.
WEBKNOSSOS fits an affine transform to the landmark pairs, shows the result right away and can store it as the default transform of the moving layer.
The workflow is similar to the [BigWarp](https://imagej.net/plugins/bigwarp) plugin of Fiji.

## Opening the Alignment Page

In the **Datasets** tab of your dashboard, open the context menu of a dataset (right-click or "…") and choose **Align Layers…**.
You can also use the **Align Layers…** button in the **Data Source** tab of the [dataset settings](./settings.md).
The dataset needs at least two layers.

The alignment page lists the existing alignments of the dataset, so you can continue an earlier one instead of starting over.
Each alignment is stored in its own *alignment annotation*, which belongs to exactly one layer pair, shown as `moving → fixed`.

- Select a fixed and a moving layer to see only the alignments of that pair.
- Click **Create new alignment** to start a new one for the selected pair.
- Click **Open** to continue one of your alignments.
- Alignments of other users (e.g., shared with your team) can't be edited directly. Use **Copy to my account** to continue working on your own copy.

Alignment annotations also appear in your list of annotations. Opening one there leads to the alignment view as well.

## Placing Landmarks

The alignment view shows the fixed layer on the left and the moving layer on the right.
Each side shows only its own layer at first.
As soon as an alignment is computed (see below), both views also show the other layer. Press **x** to hide it again.

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
Landmarks without a partner are not used for the alignment.
The landmarks are saved automatically. Use the save button in the toolbar of the left view to save right away.

## Computing the Alignment

The alignment is computed automatically when you open an alignment and after every new, moved or deleted landmark.
The moving layer is then shown transformed in the left view, and the fixed layer inversely transformed in the right view.
To compute it only on request, switch off **Align automatically after every change** in the side panel (see below).
Then press **t** or the **Align** button in the side panel.

An alignment needs at least four landmark pairs that don't all lie in one plane.
If all landmarks lie in a single z slice, three pairs are enough. WEBKNOSSOS then assumes that the two layers are only shifted against each other along z.

More shortcuts, which work in the view under the mouse pointer:

- **x**: show or hide the other layer in this view.
- **y**: move the other view to the position that corresponds to the position of this view (needs a computed alignment).

The side panel on the right is open when the alignment view starts. The table button in the toolbar of the left view hides and shows it. A link at the top of the panel leads back to the list of alignments. The panel shows whether the layers are aligned and whether the landmarks changed since the last alignment, lets you show the other layer in each view, and lists all landmark pairs.
For each pair, the list shows how far apart its two landmarks still are after the alignment. A pair whose error is much higher than that of the others is highlighted, because it was probably placed imprecisely.
The list also shows the color and the coordinates of both landmarks of each pair. Landmarks without a partner are highlighted.
Click a pair to select its landmarks in both views and move both views to them.
The download button saves the complete pairs as a BigWarp CSV file or as two NML files, which you can use in the [dataset composition](./composing.md).
The name and description of the alignment can be edited at the top of the side panel.

## Storing the Alignment

Click **Apply to dataset…** in the side panel to store the alignment as the default transform of the moving layer.
This replaces the transforms that the moving layer had before. It requires the right to edit the dataset.

## Aligning More Than Two Layers

Choose one layer as the fixed reference and align every other layer to it, one pair at a time.
For example, align layer 2 to layer 1, then layer 3 to layer 1.
Each alignment only changes the transform of its own moving layer, so the alignments don't overwrite each other.

Aligning a layer to a layer that was moved itself (e.g., layer 3 to layer 2 after aligning layer 2 to layer 1) isn't supported yet.
If the fixed layer already has transforms, the stored alignment builds on them, and changing them later makes the alignment outdated.
