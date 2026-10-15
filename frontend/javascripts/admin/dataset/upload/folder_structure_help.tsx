import { Button, Modal, Tabs, Typography } from "antd";
import { useState } from "react";

const DOCS_URL = "https://docs.webknossos.org/webknossos/data";

type FolderStructureExample = {
  key: string;
  label: string;
  description: string;
  tree: string;
  docsPath: string;
  needsConversion: boolean;
};

// Ordered like the format tags of the dropzone.
const FOLDER_STRUCTURE_EXAMPLES: FolderStructureExample[] = [
  {
    key: "image-stack",
    label: "Image stack",
    description:
      "A flat list of 2D images (TIFF, PNG, JPEG, DM3/DM4). The files are sorted by name to obtain the z-order. A zip archive works as well.",
    tree: `
great_dataset          # Root folder or zip archive (may be omitted)
├─ slice_0001.tif      # The files don't have to follow a certain naming pattern.
├─ slice_0002.tif      # However, they are sorted by name to obtain the z-order.
├─ slice_0003.tif
└─ ...`,
    docsPath: "image_stacks.html",
    needsConversion: true,
  },
  {
    key: "multi-layer-image-stack",
    label: "Multi-layer image stack",
    description: "One folder of 2D images per layer creates a multi-layer dataset.",
    tree: `
great_dataset          # Root folder or zip archive (may be omitted)
├─ color               # 1st layer (the folder name becomes the layer name)
│  ├─ slice_0001.tif
│  ├─ slice_0002.tif
│  └─ ...
└─ segmentation        # 2nd layer
   ├─ slice_0001.tif
   ├─ slice_0002.tif
   └─ ...`,
    docsPath: "image_stacks.html",
    needsConversion: true,
  },
  {
    key: "ome-zarr",
    label: "OME-Zarr",
    description:
      "An OME-Zarr (NGFF 0.4+) image. Version 0.5 uses zarr.json files instead of .zgroup, .zattrs and .zarray.",
    tree: `
great_dataset.zarr     # Root folder, one OME-Zarr image
├─ .zgroup
├─ .zattrs             # OME metadata: multiscales, voxel size, channels
├─ 0                   # Magnification step (full resolution)
│  ├─ .zarray          # Array metadata (data type, shape, chunk size)
│  └─ 0/0/0/0/0        # Chunks in a nested directory layout (t/c/z/y/x)
├─ 1/...               # Downsampled magnification steps
└─ labels              # Optional segmentations
   └─ cells/...`,
    docsPath: "zarr.html",
    needsConversion: false,
  },
  {
    key: "zarr",
    label: "Zarr",
    description: "A Zarr 3 dataset in WEBKNOSSOS layout with one folder per layer.",
    tree: `
great_dataset          # Root folder
├─ datasource-properties.json  # Metadata (created on import, if missing)
├─ color               # Layer (e.g. color, segmentation)
│  ├─ zarr.json        # Layer metadata
│  ├─ 1                # Magnification step (1, 2, 4, 8, 16 etc.)
│  │  ├─ zarr.json     # Array metadata
│  │  └─ c/0/0/0/0     # Shards
│  └─ 2/...
└─ segmentation/...`,
    docsPath: "zarr.html",
    needsConversion: false,
  },
  {
    key: "wkw",
    label: "WKW",
    description: "A dataset in the webKnossos-wrap (WKW) format with one folder per layer.",
    tree: `
great_dataset          # Root folder
├─ datasource-properties.json  # Metadata (created on import, if missing)
├─ color               # Layer (e.g. color, segmentation)
│  ├─ 1                # Magnification step (1, 2, 4, 8, 16 etc.)
│  │  ├─ header.wkw    # WKW header
│  │  ├─ z0
│  │  │  ├─ y0
│  │  │  │  ├─ x0.wkw  # Data files
│  │  │  │  └─ x1.wkw
│  │  │  └─ y1/...
│  │  └─ z1/...
│  └─ 2/...
└─ segmentation/...`,
    docsPath: "wkw.html",
    needsConversion: false,
  },
  {
    key: "n5",
    label: "N5",
    description: "An N5 container with one group per layer.",
    tree: `
great_dataset.n5       # Root folder
├─ attributes.json     # Dataset metadata
└─ em                  # One N5 group per layer
   ├─ attributes.json
   ├─ s0               # Magnification step
   │  └─ 0/0/0         # Chunks, enumerated by their position in the chunk grid
   ├─ s1/...
   └─ ...`,
    docsPath: "n5.html",
    needsConversion: false,
  },
  {
    key: "neuroglancer-precomputed",
    label: "Neuroglancer Precomputed",
    description: "A Neuroglancer Precomputed volume.",
    tree: `
great_dataset.precomputed  # Root folder
├─ info                # Metadata in JSON format (data type, scales, voxel size)
├─ 8_8_40              # One folder per scale, named after the scale's "key"
│  ├─ 0-64_0-64_0-64   # Chunks
│  └─ ...
├─ 16_16_40/...
└─ ...`,
    docsPath: "neuroglancer_precomputed.html",
    needsConversion: false,
  },
  {
    key: "single-files",
    label: "Single image files",
    description:
      "A single volumetric image file such as a multi-page TIFF, CZI, Imaris (IMS) or NIfTI file.",
    tree: `
great_dataset.czi      # The file itself, or a zip archive containing it`,
    docsPath: "image_stacks.html",
    needsConversion: true,
  },
];

function FolderStructureTab({ example }: { example: FolderStructureExample }) {
  return (
    <>
      <Typography.Paragraph>{example.description}</Typography.Paragraph>
      <pre className="dataset-import-folder-structure-hint">{example.tree.trim()}</pre>
      <a href={`${DOCS_URL}/${example.docsPath}`} target="_blank" rel="noopener noreferrer">
        Read more about {example.label} in the documentation
      </a>
    </>
  );
}

export function FolderStructureHelp({
  isDatasetConversionEnabled,
}: {
  isDatasetConversionEnabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const examples = FOLDER_STRUCTURE_EXAMPLES.filter(
    (example) => isDatasetConversionEnabled || !example.needsConversion,
  );

  return (
    <>
      <Button type="link" onClick={() => setIsOpen(true)}>
        How should my folder look?
      </Button>
      <Modal
        title="How should my folder look?"
        open={isOpen}
        onCancel={() => setIsOpen(false)}
        footer={null}
        width={1000}
      >
        <Tabs
          tabPlacement="start"
          items={examples.map((example) => ({
            key: example.key,
            label: example.label,
            children: <FolderStructureTab example={example} />,
          }))}
        />
      </Modal>
    </>
  );
}
