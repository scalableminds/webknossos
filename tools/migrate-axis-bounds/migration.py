from pathlib import Path
import json
import shutil
import time
import argparse

# Traverses a binaryData directory and changes all datasource-properties.jsons
# that include additionalAxes, increasing the upper bound by 1
# This follows a change in the upper bound semantic to be exclusive

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dry",
        action="store_true",
    )
    parser.add_argument("binary_data_dir", type=Path, help="WEBKNOSSOS binary data dir")
    args = parser.parse_args()
    dry = args.dry
    binary_data_dir = args.binary_data_dir

    count = 0
    print(f"Traversing datasets at {binary_data_dir.resolve()} ...")
    for orga_dir in [item for item in binary_data_dir.iterdir() if item.is_dir()]:
        for dataset_dir in [item for item in orga_dir.iterdir() if item.is_dir()]:
            json_path = dataset_dir / "datasource-properties.json"
            if json_path.exists():
                changed = False
                with open(json_path, 'r') as json_file:
                    content = json.load(json_file)
                    for layer in content.get("dataLayers", []):
                        for axis in layer.get("additionalAxes", []):
                            if "bounds" in axis:
                                bounds = axis["bounds"]
                                if len(bounds) >= 2:
                                    bounds[1] = bounds[1] + 1
                                    changed = True
                if changed:
                    print(f"Updating {json_path} (dry={dry})...")
                    count += 1
                    backup_path = Path(f"{json_path}.{round(time.time() * 1000)}.bak")

                    if not dry:
                        shutil.copyfile(json_path, backup_path)
                        with open(json_path, 'w') as json_outfile:
                            json.dump(content, json_outfile, indent=4)

    print(f"Updated {count} datasets (dry={dry})")

if __name__ == '__main__':
    main()
