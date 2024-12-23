# Terminology

## Datasets

A **dataset**, can consist of multiple **layer**s, which may be

* **segmentation layer**s or
* **color layer**s.

Layers contain image data in one or multiple **magnification**s or short **mag**s (see [mipmap](https://en.wikipedia.org/wiki/Mipmap) or [image pyramids](https://en.wikipedia.org/wiki/Pyramid_(image_processing)) for similar concepts).
The magnification `4` or `4-4-4` describes a downsampling factor of 4 in each dimension, `4-4-2` specifies anisotropic downsampling.
The image data in full resolution is referred to as the **finest** mag, e.g. `1-1-1`, downsampled variants are more **coarse**.

The **voxel size** describes the size of a voxel in mag `1`, the default unit is *nm* if not specified otherwise.

The underlying file formats zarr and wkw use **chunks** as a compressible unit and **shards** as a storage unit. A wkw block corresponds to a chunk, and a file to a shard.


## Annotations

An **annotation** can consist of one or multiple **annotation layers**, which can either be a

* **volume annotation layer**, or **volume layer** in short ([main guide](./volume_annotation/index.md)), or
* **skeleton annotation layer**, or **skeleton layer** and **skeleton** in short ([main guide](./skeleton_annotation/index.md)).

**Volume-only** and **skeleton-only** annotations are restricted to the specific annotation layer type.

A **skeleton** consists of **trees** with nodes and edges, which may be organized in **groups**.
A tree is supposed to be a single connected component. Despite the name, it may contain cycles.

**Branchpoint**s are boolean markers on nodes, that can be jumped to easily in the frontend. They are not tied to any network-specific properties of the node.


## Tasks & Projects

A **task** specifies a desired annotation result. A **task instance** refers to the concrete copy of a task assigned to a user for annotation work. A task may be handed out to several users for redundancy resulting in several task instances, each containing their respective annotation. Task instances may also be abbreviated as tasks if the context is clear.

A **project** is a collection of tasks.

See also the [task and projects guide](./tasks_projects/index.md).

## Segments
At its lowest-level a **segment** is the collection of several annotated voxels. At a larger level, segments can grow to be the size of whole cell bodies or partial cells, e.g. a single axon.

Typically, many segments make up a segmentation. Segments can be painted manually using the WEBKNOSSOS volume annotation tools or created through third-party programs typically resulting in larger segmentations of a dataset.

## Agglomerates
An agglomerate is the combination of several (smaller) segments to reconstruct a larger biological structure. Typically an agglomerate combines the fragments of an over-segmentation created by some automated method, e.g. a machine learning system. 
Sometimes this is also referred to as a super-voxel graph.
