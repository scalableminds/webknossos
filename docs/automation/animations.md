# Animations

A picture is worth a thousand words. In this spirit, you can use WEBKNOSSOS to create eye-catching animations of your datasets as a video clip. You can use these short movies as part of a presentation, website, for social media or to promote a publication.

![type:video](https://static.webknossos.org/assets/docs/webknossos_animation_example.mp4){: autoplay loop muted}

## Creating an Animation

Creating an animation is easy:

1. Open any dataset or annotation that you want to use for your animation.
2. Optionally, load some [3D meshes](../meshes/index.md) for any segments that you wish to highlight.
3. For larger datasets, use the bounding box tool to create a bounding box around your area of interest. Smaller datasets can be used in their entirety.
4. From the `Menu` dropdown in the navbar at the top of the screen, select "Create Animation".
5. Configure the animation options in the modal that opens.
6. Click the `Start Animation` button to launch the animation creation.

Either periodically check the [background jobs page](./jobs.md) or wait for an email confirmation to download the animation video file. Creating an animation may take a while, depending on the selected bounding box size and the number of included 3D meshes.

## Animation Options

The "Create Animation" modal offers several options to customize your animation:

### Camera Position

This setting determines the movement of the camera in the animation.

- **Camera circling around the dataset:** The camera will rotate around the center of the bounding box.
- **Static camera looking at XY/XZ/YZ-viewport:** The camera will be fixed on one of the 2D viewports.
- **Static camera with an isometric perspective:** The camera will be in a fixed position showing a 3D view of the data.

### Movie Resolution

You can choose between two resolutions for your animation video:

- **Standard Definition (640x360):** A smaller resolution, suitable for quick previews or sharing.
- **High Definition (1920x1080):** A full HD resolution, ideal for presentations and high-quality showcases. Access to this option may depend on your WEBKNOSSOS plan.

### Options

- **Include the currently selected 3D meshes:** If checked, the animation will include any meshes that are currently loaded in the 3D view.
- **Include WEBKNOSSOS Watermark:** If checked, the WEBKNOSSOS logo will be displayed as a watermark on the animation video. Access to this option may depend on your WEBKNOSSOS plan.

### Layer & Bounding Box

- **Layer:** Select the data layer to be used for the animation.
- **Bounding Box:** Choose the bounding box for the animation. By default, the entire layer is selected. You can create custom bounding boxes using the [bounding box tool](../ui/toolbar.md#measurement-and-analysis).
