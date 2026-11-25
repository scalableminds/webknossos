# Composing Datasets

New datasets can also be composed from combining existing ones.
This feature allows you to combine layers from previously added datasets to create a new dataset.
During composition, transforms can optionally be defined in case the datasets are not in the same coordinate system.
There are three different ways to compose a new dataset:

1. Combine datasets by selecting from existing datasets. No transforms between these datasets will be added.
2. Create landmark annotations (using the skeleton tool) for each dataset. Then, these datasets can be combined while transforming one dataset to match the other.
3. Similar to (2), two datasets can be combined while respecting landmarks that were generated with BigWarp.

With landmarks (2 and 3), the first dataset is transformed to match the second one, either with an affine transformation or with thin plate splines.

- An affine transformation needs at least four landmark pairs that don't all lie in one plane. If all landmarks of a dataset lie in a single slice (e.g., a single z slice), three pairs are enough, as long as they do not lie on one line. The transformation is then fitted within that slice and doesn't scale along the axis of the slice. If the landmarks of both datasets lie in one slice, it only shifts the dataset along that axis by the distance between the two slices.
- Thin plate splines need landmarks that don't all lie in one plane. Otherwise, WEBKNOSSOS asks whether it should assume a constant shift along z. This works if all landmarks lie in one z slice.

If you don't have landmarks yet, combine the datasets without any transforms (1) and [register the layers](./registering_layers.md) in WEBKNOSSOS afterwards.

See the "Compose from existing datasets" tab in the "Add Dataset" page for more details.

![youtube-video](https://www.youtube.com/embed/BV6Hw9v3pao)