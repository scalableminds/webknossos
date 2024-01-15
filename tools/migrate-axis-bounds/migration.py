from pathlib import Path
import json
import shutil

def main():
    binary_data_dir = Path("../../binaryData")
    for orga_dir in [item for item in binary_data_dir.iterdir() if item.is_dir()]:
        for dataset_dir in [item for item in orga_dir.iterdir() if item.is_dir()]:
            json_path = dataset_dir / "datasource-properties.json"
            if json_path.exists():
                changed = False
                print(f"opening {json_path}...")
                with open(json_path, 'r') as json_file:
                    content = json.load(json_file)
                    if "dataLayers" in content:
                        for layer in content["dataLayers"]:
                            if "additionalAxes" in layer:
                                print(layer["additionalAxes"])
                                for axis in layer["additionalAxes"]:
                                    if "bounds" in axis:
                                        bounds = axis["bounds"]
                                        if len(bounds) >= 2:
                                            bounds[1] = bounds[1] + 1
                                            changed = True
                if changed:
                    # TODO copy old file to .bak (add digit if that already exists)
                    # TODO write new file

                    with open(json_path, 'w') as json_outfile:
                        json.dump(content, json_outfile, indent=4)



if __name__ == '__main__':
    main()
