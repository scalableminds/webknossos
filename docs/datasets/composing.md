# Composing Datasets

New datasets can also be composed from combining existing ones.
This feature allows to combine layers from previously added datasets to create a new dataset.
During compositions, transforms can optionally be defined in case the datasets are not in the same coordinate system.
There are three different ways to compose a new dataset:

1. Combine datasets by selecting from existing datasets. No transforms between these datasets will be added.
2. Create landmark annotations (using the skeleton tool) for each dataset. Then, these datasets can be combined while transforming one dataset to match the other.
3. Similar to (2), two datasets can be combined while respecting landmarks that were generated with BigWarp.

See the "Compose from existing datasets" tab in the "Add Dataset" screen for more details.

![youtube-video](https://www.youtube.com/embed/BV6Hw9v3pao)

