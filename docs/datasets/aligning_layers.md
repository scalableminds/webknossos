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

1. Find a structure that you can recognize in both layers.
2. Click on it in the left view, then click on the same spot in the right view. Every click creates a new landmark.
3. Repeat this for several structures that are spread over the dataset.

Landmarks are paired by their order: the first landmark on the left belongs to the first landmark on the right, and so on.
The landmarks are saved automatically. Use the save button in the toolbar of the left view to save right away.

## Computing the Alignment

Press **t** (or the align button in the toolbar of the left view) to compute the alignment.
The moving layer is then shown transformed in the left view, and the fixed layer inversely transformed in the right view.
When you open an alignment, it is computed automatically as soon as its landmarks are loaded.

An alignment needs at least four landmark pairs that don't all lie in one plane.
If all landmarks lie in a single z slice, three pairs are enough. WEBKNOSSOS then assumes that the two layers are only shifted against each other along z.

More shortcuts, which work in the view that has the keyboard focus:

- **x**: show or hide the other layer in this view.
- **y**: move the other view to the position that corresponds to the position of this view (needs a computed alignment).

The table button in the toolbar of the left view opens a panel with all landmark pairs.
Its **Error** column shows how far apart each pair still is after the alignment. A pair with a much higher error than the others was probably placed imprecisely.

## Storing the Alignment

Click **Store as Default** in the landmark panel to store the alignment as the default transform of the moving layer.
This replaces the transforms that the moving layer had before. It requires the right to edit the dataset.

## Aligning More Than Two Layers

Choose one layer as the fixed reference and align every other layer to it, one pair at a time.
For example, align layer 2 to layer 1, then layer 3 to layer 1.
Each alignment only changes the transform of its own moving layer, so the alignments don't overwrite each other.

Aligning a layer to a layer that was moved itself (e.g., layer 3 to layer 2 after aligning layer 2 to layer 1) isn't supported yet.
If the fixed layer already has transforms, the stored alignment builds on them, and changing them later makes the alignment outdated.
