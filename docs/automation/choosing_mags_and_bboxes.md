# Choosing Magnification and Bounding Boxes for AI Analysis in WEBKNOSSOS

This document explains how to choose an appropriate magnification for custom AI training on volume EM datasets and how to define bounding boxes for ground truth generation. 

---

## Part 1: Choosing the Right Magnification

**Choose the coarsest magnification at which you can still annotate with the required accuracy**. All features needed for the task must remain clearly recognizable. Using a finer magnification than necessary usually increases annotation effort and computational cost without improving results.

Training at a coarser magnification has two important effects:

- The model sees **more spatial context**, which typically improves learning.
- The model output is produced **only at the magnification used for training**.

### Practical guidance

- **Neuron segmentation:** Experience has shown that computing a neuron segmentation for a dataset in a voxel size finer than **8 nm/vx** usually doesn’t offer any benefits. Consider switching to the next-coarse magnification instead to benefit from increased data context.
- **Instance segmentation / object detection:** The optimal magnification depends on the objects of interest. Choose the coarsest magnification at which object boundaries and distinguishing features are still clearly visible.

---

## Part 2: Defining Bounding Boxes for Ground Truth Generation

Bounding boxes should provide enough spatial context while remaining efficient to annotate. Because vEM data is often anisotropic, box dimensions should be adapted so that boxes are as close to cubic as possible in physical space.

### Box size and magnification

Box dimensions are always interpreted **relative to the chosen magnification**. Internally, the model effectively sees the box size divided by the magnification. 

Each bounding box should contain **at least 250,000 voxels in the chosen magnification**. 

- Minimum effective box size:
    - For neuron finetuning: **85 × 85 × 32 voxels**
    - For instance segmentation: minimum effective box size is **32 x 32 x 32 voxels** in the chosen magnification.
- Box dimensions should be integer multiples of these values in each dimension
- Recommended total annotated volume per finetuning: **5–10 million voxels** (in the chosen magnification)

When distributing this volume, **many smaller, well-distributed boxes are preferable to a few large contiguous ones**. For example, ten spatially distributed boxes of size 85 × 85 × 32 voxels usually provide better results than a single larger volume of size 170 × 425 × 32 voxels.

- The box dimensions must also be divisible by the magnification.
- The top-left corner of each bounding box must be divisible by the chosen magnification.

### Examples

- Dataset scale: **11.24 × 11.24 × 30 nm/vx** → processing resolution **1–1–1:** define training boxes of **89 × 89 × 34 voxels** in WEBKNOSSOS
- Dataset scale: **4 × 4 × 35 nm/vx** → processing resolution **2–2–1** → boxes size 125 × 125 × 32 voxels in Mag 2: **define** **training boxes 250x250x32 in Mag 1** in WEBKNOSSOS

---

## Short Checklist

- Use the coarsest magnification that still allows accurate annotation
- Ensure box sizes are defined relative to magnification
- Use ≥250,000 voxels per box (general case)
- For neuron finetuning, respect the 85 × 85 × 32 effective minimum
- Prefer many well-distributed boxes over a few large ones
- Ensure box position and size are divisible by magnification