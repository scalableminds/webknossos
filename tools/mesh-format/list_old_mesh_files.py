from pathlib import Path
import h5py
import argparse
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("binary_data_dir", type=Path, help="WEBKNOSSOS binary data dir")
    parser.add_argument(
        "--all",
        "-a",
        action="store_true",
        help="Print all files, not just old versions",
    )
    parser.add_argument(
        "--plain",
        "-p",
        action="store_true",
        help="Print only the file names, not the version",
    )
    args = parser.parse_args()
    binary_data_dir = args.binary_data_dir

    if not args.plain:
        print(f"Scanning {binary_data_dir} for mesh files", file=sys.stderr)

    seen = []

    for orga_dir in [
        item for item in binary_data_dir.iterdir() if item.exists() and item.is_dir()
    ]:
        for dataset_dir in orga_dir.iterdir():
            try:
                if dataset_dir.exists() and dataset_dir.is_dir():
                    for layer_dir in [
                        item
                        for item in dataset_dir.iterdir()
                        if item.exists() and item.is_dir()
                    ]:
                        meshes_dir = layer_dir.joinpath("meshes")
                        if meshes_dir.exists():
                            for mesh_file in [
                                item
                                for item in meshes_dir.iterdir()
                                if item.name.endswith(".hdf5")
                            ]:
                                if mesh_file.exists():
                                    with h5py.File(mesh_file, "r") as f:
                                        try:
                                            version = f.attrs["artifact_schema_version"]
                                        except KeyError:
                                            version = 0
                                        if version < 3 or args.all:
                                            realpath = mesh_file.resolve()
                                            if realpath not in seen:
                                                seen.append(realpath)
                                                if args.plain:
                                                    print(mesh_file)
                                                else:
                                                    print(
                                                        f"{mesh_file} has version {version}"
                                                    )
            except Exception as e:
                if not args.plain:
                    print(
                        f"Exception while scanning dataset dir at {dataset_dir}: {e}",
                        file=sys.stderr,
                    )

    if not args.plain:
        print(
            f"Done scanning {binary_data_dir}, listed {len(seen)} meshfiles.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
