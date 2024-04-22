from pathlib import Path
import argparse
import sys
import os


def format_bytes(num):
    for unit in ("", "K", "M", "G", "T"):
        if abs(num) < 1000.0:
            return f"{int(num)}{unit}"
        num /= 1000.0
    return f"{int(num)}P"



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
        print(f"Scanning {binary_data_dir} for json mapping files...\n", file=sys.stderr)

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
                        mappings_dir = layer_dir.joinpath("mappings")
                        if mappings_dir.exists():
                            for mapping_file in [
                                item
                                for item in mappings_dir.iterdir()
                                if item.name.lower().endswith(".json")
                            ]:
                                realpath = mapping_file.resolve()
                                if realpath not in seen:
                                    seen.append(realpath)
                                    size = os.stat(realpath).st_size
                                    print(
                                        f"{format_bytes(size)} {mapping_file}"
                                    )
            except Exception as e:
                if not args.plain:
                    print(
                        f"Exception while scanning dataset dir at {dataset_dir}: {e}",
                        file=sys.stderr,
                    )

    if not args.plain:
        print(
            f"\nDone scanning {binary_data_dir}, listed {len(seen)} json mappings.",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
