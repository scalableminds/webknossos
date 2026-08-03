# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "webknossos",
#     "numpy",
# ]
# ///
#
# Run with: uv run create-dataset-for-dtype.py
# (uv reads the inline metadata above and installs the dependencies
# into a throwaway environment automatically, no venv/pip needed)

import numpy as np

import webknossos as wk

# ruff: noqa: F841 unused-variable


def get_dtype_range(dtype):
    """
    Returns the minimum and maximum values for the given dtype.

    Parameters:
        dtype: The NumPy data type.

    Returns:
        A tuple (min, max) for the dtype range.
    """
    if dtype == np.float32:
        # This is what WebGL supports as min/max in float32 textures
        return (-(2**127), 2**127)
    elif dtype == np.uint64:
        return (0, 2**64 - 1)
    elif dtype == np.int64:
        return (-(2**63), 2**63 - 1)

    if np.issubdtype(dtype, np.integer):
        info = np.iinfo(dtype)
    elif np.issubdtype(dtype, np.floating):
        info = np.finfo(dtype)
    else:
        raise TypeError(
            "Unsupported dtype. Only integer and floating-point types are supported."
        )
    return info.min, info.max


def main() -> None:
    ######################
    # Creating a dataset #
    ######################

    dtypes = [
        np.int8,
        np.uint8,
        np.int16,
        np.uint16,
        np.int32,
        np.uint32,
        np.float32,
        np.uint64,
        np.int64,
    ]

    for dtype in dtypes:
        for category in ["color", "segmentation"]:
            dtype_str = str(np.dtype(dtype))
            layer_name = f"{dtype_str}_{category}"
            new_dataset_name = f"dtype_test_{layer_name}"
            dataset = wk.Dataset(new_dataset_name, voxel_size=(11, 11, 24))
            write_dtype_layer(dataset, dtype, category)

            dataset.compress()

            print("Downsample...")
            list(dataset.layers.values())[0].downsample()
            # print("Done.")


def write_dtype_layer(
    dataset,
    dtype,
    category,
):
    dtype_str = str(np.dtype(dtype))
    print(f"Writing layer for dtype={dtype_str} and category={category}...")
    layer = dataset.get_or_add_layer(
        layer_name=dtype_str + "_" + category,
        category=category,
        dtype_per_channel=dtype,
        num_channels=1,
    )
    mag1 = layer.get_or_add_mag("1")

    bin_count = 64
    min_value, max_value = get_dtype_range(dtype)

    if dtype == np.int64 or dtype == np.uint64:
        # https://github.com/numpy/numpy/issues/17155
        values = np.zeros((bin_count,), dtype=dtype)
        increment = int(int((max_value - min_value)) // int(bin_count - 1))
        val = int(min_value)
        for idx in range(bin_count):
            if idx > 0:
                val += int(increment)
            values[idx] = val
        values[-1] = max_value
    else:
        # Generate $bin_count equally spaced values in the valid dtype range
        values = np.linspace(min_value, max_value, bin_count, dtype=dtype)

    assert min_value == values[0]
    assert max_value == values[-1]

    ds_width = 1024
    ds_height = 512
    ds_depth = 32
    row_offsets = list(
        range(-7, 9)
    )  # from -7 to 8 produces 16 values which makes for a good height
    row_count = len(row_offsets)
    assert row_count == 16, f"{row_count} == 16"
    data = np.zeros((1, ds_width, ds_height, ds_depth), dtype=dtype)

    # Define rectangle dimensions
    rect_height = ds_height // row_count
    rect_width = ds_width // bin_count

    # Fill the data array with rectangles of different values
    for i, value in enumerate(values):
        col = i % bin_count  # Calculate column index
        start_col = col * rect_width
        end_col = start_col + rect_width

        # Do the offset arithmetic with Python's arbitrary-precision int/float
        # (not the fixed-width dtype) so that out-of-range results don't
        # silently wrap around before they reach the clamp below.
        base_value = int(value) if np.issubdtype(dtype, np.integer) else float(value)

        for row_idx, row_offset in enumerate(row_offsets):
            # Define the rectangle's boundaries
            start_row = row_idx * rect_height
            end_row = start_row + rect_height

            # print(f"Writing {value} at {start_col}:{end_col}, {start_row}:{end_row}")
            row_value = base_value + row_offset

            row_value = min(max_value, row_value)
            row_value = max(min_value, row_value)
            data[0, start_col:end_col, start_row : end_row - 1, :] = row_value
            # Add a 1-px border between the rows
            data[0, start_col:end_col, end_row - 1 : end_row, :] = max_value

            subrect_x, subrect_y = (
                start_col + rect_width // 2,
                start_row + rect_height // 2,
            )

            center_slice = (
                0,
                slice(subrect_x, subrect_x + 2),
                slice(subrect_y, subrect_y + 2),
                None,
            )

            if row_value == min_value:
                data[center_slice] = max_value
            elif row_value == max_value:
                data[center_slice] = min_value
            elif row_value == 0:
                data[center_slice] = max_value

    top_bar_width = ds_width
    for z in range(ds_depth):
        data[
            0,
            :,
            0,
            z,
        ] = np.arange(-top_bar_width // 2, top_bar_width // 2).astype(dtype)

    # Write the data to the dataset
    mag1.write(absolute_offset=(0, 0, 0), data=data, allow_resize=True)


if __name__ == "__main__":
    main()
