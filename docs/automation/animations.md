# Animations

A picture is worth a thousand words. In this spirit, you can use WEBKNOSSOS to create eye-catching animations of your datasets as a video clip. You can use these short movies as part of a presentation, website, for social media or to promote a publication.

Watch this short video on how to create an animation:
![youtube-video](https://www.youtube.com/embed/K0ToMhFlE-Y)

## Creating an Animation

Creating an animation is easy:

1. Open any dataset or annotation that you want to use for your animation.
2. Optionally, load some [3D meshes](../meshes/index.md) for any segments that you wish to highlight. When working in an annotation, skeleton trees can also be included in the animation.
3. For larger datasets, use the bounding box tool to create a bounding box around your area of interest. Smaller datasets can be used in their entirety.
4. From the `Menu` dropdown in the navbar at the top of the screen, select "Create Animation".
5. Configure the animation options in the modal that opens. Under **Layer & data**, choose the **Color layer** and, optionally, a **Segmentation layer** to show alongside it. Choose the **Bounding box** below the layer selectors.
6. Click the `Create animation` button to launch the animation creation.

Either periodically check the [background jobs page](./jobs.md) or wait for an email confirmation to download the animation video file. Creating an animation may take a while, depending on the selected bounding box size and the number of included 3D meshes.

## Animation Options

The "Create Animation" modal offers several options to customize your animation:

### Camera Position

This setting determines the movement of the camera in the animation.

- **Orbiting camera (circles the dataset):** The camera will rotate around the center of the bounding box.
- **Fixed camera — XY/XZ/YZ view:** The camera will be fixed, looking at one of the 2D viewports.
- **Fixed isometric view (all 3 viewports):** The camera will be in a fixed position showing a 3D isometric view of the data.

### Movie Resolution

You can choose between two resolutions for your animation video:

- **Standard Definition (640×360):** A smaller resolution, suitable for quick previews or sharing.
- **High Definition (1920×1080):** A full HD resolution, ideal for presentations and high-quality showcases. Access to this option may depend on your WEBKNOSSOS plan.

### Video Duration

Controls the length of the rendered video. Longer durations result in a slower, more detailed camera movement and take more time to render.

- **Fast:** A short clip (≈ 15 seconds).
- **Standard:** The default length (≈ 22 seconds).
- **Slow:** A longer clip (≈ 30 seconds).

### Content

- **Include 3D meshes:** If checked, the animation will include any meshes that are currently visible in the 3D view.
- **Include skeletons:** If checked, the visible skeleton trees of the current annotation will be included in the animation. This option is only available when viewing an annotation that contains a skeleton layer (not in view-only mode).
- **Hide image data:** If checked, both the color and segmentation image data are hidden and only the 3D meshes and skeletons are rendered. Useful for showcasing segmented objects on their own.
- **WEBKNOSSOS watermark:** If checked, the WEBKNOSSOS logo will be displayed as a watermark on the animation video. Access to this option may depend on your WEBKNOSSOS plan.

### Layer & Data

- **Color layer:** Select the color layer to be used for the animation.
- **Segmentation layer (optional):** Select one dataset segmentation layer to include alongside the color layer. The selector appears next to **Color layer** when a dataset segmentation is available. By default, no segmentation is selected; use the clear button to return to this setting.
- **Bounding Box:** Choose the bounding box for the animation. By default, the entire layer is selected. You can create custom bounding boxes using the [bounding box tool](../ui/toolbar.md#measurement-and-analysis).

### Including Segmentation

When a segmentation layer is selected, the animation starts with the color layer alone, then gradually fades in the segmentation colors. The color layer remains visible underneath, making it possible to see the segmented structures in their original image context. Both layers use the same selected bounding box.

This option displays segmentation on the image planes and does not require loading 3D meshes. To include meshes as well, load them in the viewer and enable **Include 3D meshes**. Keep **Hide image data** unchecked to show the segmentation on the image planes.

When creating an animation from an annotation, the selector uses the underlying dataset's fallback segmentation. Volume annotation edits and annotation-only segmentation layers are not included.
