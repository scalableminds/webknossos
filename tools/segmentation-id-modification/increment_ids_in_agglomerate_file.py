#!/usr/bin/env python3
"""
Script to copy an agglomerate file while incrementing segment and agglomerate IDs by a constant.
This is useful for testing agglomerate file support for certain dtypes (e.g., uint64 with ids > 2**32).
Usage:
- first, adapt the module constants if needed
- source ./activate.sh in voxelytics
- python increment_ids_in_agglomerate_file.py dataset/segmentation/agglomerates dataset/segmentation/agglomerates-new

Also see the increment_segmentation_layer_ids.py script to adapt the corresponding segmentation layer.
"""

import sys
from pathlib import Path
import numpy as np

from voxelytics.connect.artifacts.agglomerate_view_artifact import AgglomerateViewArtifact
from voxelytics.connect.artifacts.mapping_artifact import (
    MetadataSchema,
)

ID_OFFSET = 4_300_000_000  # This is greater than 2**32 and produces nice IDs when the original ids are small
AVAILABLE_MAPPINGS = [50]
SEGMENTATION_DTYPE = np.uint64

# Arrays that need to be shifted right **and** have IDs incremented
INCREMENT_ARRAYS = {
    "segment_to_agglomerate",
    "agglomerate_to_segments",
    "agglomerate_to_segments_offsets",
    "agglomerate_to_edges_offsets",
}

# Arrays that only need to be shifted right (no ID increment)
SHIFT_ONLY_ARRAYS = {
    "agglomerate_to_edges",
    "agglomerate_to_positions",
    "agglomerate_to_affinities",
}


def copy_agglomerate_file(input_path: str, output_path: str) -> None:
    """Copy an agglomerate file while shifting IDs by 2**32."""

    input_artifact = AgglomerateViewArtifact(True, Path(input_path), "input", MetadataSchema(
        available_mappings=AVAILABLE_MAPPINGS,
        datasource_config=None,
        segmentation_dtype=SEGMENTATION_DTYPE
    ))
    output_artifact = AgglomerateViewArtifact(False, Path(output_path), "output")
    
    # Copy metadata
    output_artifact.metadata = input_artifact.metadata
    
    # Copy all arrays for each mapping
    for mapping_id in input_artifact.metadata.available_mappings:
        array_spec = input_artifact.array_spec()
        assert array_spec is not None
        
        for array_name in array_spec.schema.keys():
            reader = input_artifact.get_buffered_reader(
                array_name, format_params=(("mapping_id", mapping_id),)
            )

            # Get array info to compute output size
            input_shape = reader.shape
            input_dtype = reader.dtype

            if array_name in INCREMENT_ARRAYS or array_name in SHIFT_ONLY_ARRAYS:
                # Shift to the right by ID_OFFSET
                if len(input_shape) == 1:
                    output_shape = (input_shape[0] + ID_OFFSET,)
                else:
                    output_shape = (input_shape[0] + ID_OFFSET,) + input_shape[1:]

                # Calculate output size in bytes
                output_size = int(np.prod(output_shape))
                itemsize = np.dtype(input_dtype).itemsize
                total_bytes = output_size * itemsize

                with output_artifact.get_buffered_writer(
                    array_name,
                    total_size=total_bytes,
                    format_params=(("mapping_id", mapping_id),),
                ) as writer:
                    # Write zeros for the first ID_OFFSET positions
                    zero_chunk = np.zeros((ID_OFFSET,) + input_shape[1:], dtype=input_dtype)
                    writer.write(zero_chunk)

                    # Write data from input, with ID increment if needed
                    for chunk in reader:
                        if array_name in INCREMENT_ARRAYS:
                            # Increment IDs by ID_OFFSET
                            chunk = chunk + ID_OFFSET
                        writer.write(chunk)
            else:
                # Direct copy for other arrays
                with output_artifact.get_buffered_writer(
                    array_name,
                    total_size=reader.length,
                    format_params=(("mapping_id", mapping_id),),
                ) as writer:
                    for chunk in reader:
                        writer.write(chunk)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python increment_ids_in_agglomerate_file.py dataset/segmentation/agglomerates dataset/segmentation/agglomerates-new")
        sys.exit(1)
    
    copy_agglomerate_file(sys.argv[1], sys.argv[2])
    print(f"Copied and mutated agglomerate file from {sys.argv[1]} to {sys.argv[2]}")
