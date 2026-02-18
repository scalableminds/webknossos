#!/usr/bin/env python3
"""
Script to increment (in-place) the ids in a segmentation layer by a constant (e.g., to test certain
value ranges).
Also see the increment_ids_in_agglomerate_file.py.
Usage:
- first, adapt the module constants
- python increment_segmentation_layer_ids.py

ATTENTION: Loads the entire dataset into RAM. Only use when the dataset is small.
"""

import numpy as np
import webknossos as wk

ID_OFFSET = 4_300_000_000  # This is greater than 2**32 and produces nice IDs when the original ids are small
DATASET_PATH = "path/to/dataset",
LAYER_NAME ="segmentation",

def mutate_layer(dataset_path: str, layer_name: str, constant: int) -> None:
    # Open existing dataset
    dataset = wk.Dataset.open(dataset_path)
    layer = dataset.get_layer(layer_name)

    # Iterate over all magnifications of the layer
    for mag_name, mag in layer.mags.items():
        print(f"Processing mag {mag_name}...")

        # Read entire volume
        data = mag.read()
        dtype = data.dtype

        mutated = data.astype(np.uint64) + constant
        mutated = mutated.astype(dtype)

        # Write back at the layer's bounding box offset
        bbox = mag.bounding_box
        mag.write(
            absolute_offset=bbox.topleft,
            data=mutated,
            allow_unaligned=True,
        )

        print(f"Finished mag {mag_name}")


if __name__ == "__main__":
    mutate_layer(
        dataset_path=DATASET_PATH,
        layer_name=LAYER_NAME,
        constant=OFFSET,
    )
