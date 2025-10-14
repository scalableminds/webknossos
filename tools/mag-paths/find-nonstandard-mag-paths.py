from pathlib import Path
import argparse
import sys
import os
import json

# This script searches a binaryData folder for non-standard mag paths.

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary_data_dir", type=Path, help="WEBKNOSSOS binary data dir")
    args = parser.parse_args()
    binary_data_dir = args.binary_data_dir

    seen = 0

    for orga_dir in [
        item for item in binary_data_dir.iterdir() if item.exists() and item.is_dir() and not item.name.startswith(".")
    ]:
        for dataset_dir in orga_dir.iterdir():
            try:
                if dataset_dir.exists() and dataset_dir.is_dir():
                    if (dataset_dir / "datasource-properties.json").exists():
                        with open(dataset_dir / "datasource-properties.json") as f:
                            properties = json.load(f)
                            if "dataLayers" in properties:
                                for layer in properties["dataLayers"]:
                                    layer_name = layer["name"]
                                    if "wkwResolutions" in layer:
                                        for mag in layer["wkwResolutions"]:
                                            seen += check_mag(dataset_dir, layer_name, mag, "resolution")
                                    if "mags" in layer:
                                        for mag in layer["mags"]:
                                            seen += check_mag(dataset_dir, layer_name, mag, "mag")
            except Exception as e:
                print(
                    f"Exception while scanning dataset dir at {dataset_dir}: {e}",
                    file=sys.stderr,
                )

    print(
        f"\nDone scanning {binary_data_dir}, listed {seen} non-standard mags.",
        file=sys.stderr,
    )

def check_mag(dataset_dir, layer_name, mag, mag_key):
    seen = 0
    if "path" in mag:
        explicit_mag_path = mag["path"]
        if not Path(explicit_mag_path).is_absolute():
            if (dataset_dir / layer_name / explicit_mag_path).exists():
                seen += 1
                print(f"[{dataset_dir}] explicit mag_path ‘{explicit_mag_path}’ exists inside of layer dir ‘{layer_name} (full: {(dataset_dir / layer_name / explicit_mag_path)})’ (NONSTANDARD)")
    else:
        mag_vec3int = make_vec3int(mag[mag_key])
        mag_scalar = format_scalar(mag_vec3int)
        mag_long = format_long(mag_vec3int)

        if mag_scalar is not None:
            if (dataset_dir / layer_name / mag_scalar).exists():
                pass #print("exists scalar (OK)")
            if (dataset_dir / layer_name / mag_long).exists():
                seen += 1
                print(f"[{dataset_dir}] long-form mag ‘{mag_long}’ exists (NONSTANDARD)")
        if (dataset_dir / layer_name / mag_long).exists():
            pass # print("exists long (OK)")
    return seen

def make_vec3int(vec3int_like):
    if isinstance(vec3int_like, int):
        return [vec3int_like, vec3int_like, vec3int_like]
    if isinstance(vec3int_like, list):
        assert len(vec3int_like) == 3
        return vec3int_like

def format_scalar(vec3int):
    if (vec3int[0] == vec3int[1] and vec3int[1] == vec3int[2]):
        return str(vec3int[0])
    return None

def format_long(vec3int):
    return f"{vec3int[0]}-{vec3int[1]}-{vec3int[2]}"

if __name__ == "__main__":
    main()
