# Changelog WEBKNOSSOS

## Version 26.11.1

### Bounding box sliders

The bounding box tab has a new sliders button, so you can adjust a bounding box’s position and extent with sliders instead of typing coordinates. [#9897](https://github.com/scalableminds/webknossos/pull/9897)

![bounding box sliders](https://static.webknossos.org/assets/release_notes/bounding-box-sliders_changelog.gif)

### Animations with segmentation layers

Animations can now include a dataset’s segmentation layer in addition to the color layer. Choose it in the Create Animation dialog (Menu > Create Animation). The video renders as a background job, and you get an email when it’s ready. [#10027](https://github.com/scalableminds/webknossos/pull/10027)

![animation with segmentation layer](https://static.webknossos.org/assets/release_notes/animation-segmentation_changelog.gif)

### Other

- Sharing links now also restore the camera of the 3D viewport (position, rotation and zoom), so recipients see exactly the 3D view you shared. The projection type (perspective or orthographic) is a per-user setting and is not included. [#9868](https://github.com/scalableminds/webknossos/pull/9868)
- Hovering over a segment in a 2D viewport now highlights its mesh in the 3D viewport. [#10195](https://github.com/scalableminds/webknossos/pull/10195)

### Design updates

- The UI theme got a refresh: new fonts (Hanken Grotesk and IBM Plex Mono), updated colors and a reworked dark mode across the navbar and the annotation viewer. [#10146](https://github.com/scalableminds/webknossos/pull/10146)

  ![refreshed UI theme](https://static.webknossos.org/assets/release_notes/refreshed-ui-theme_changelog.gif)
- The Segments and Skeletons tabs were redesigned. Each segment row now has a mesh icon: click it to show or hide the segment’s mesh, or use it to load or compute a mesh. You can rename segments, skeletons and skeleton groups by double-clicking their name or through the context menu. [#10021](https://github.com/scalableminds/webknossos/pull/10021), [#10025](https://github.com/scalableminds/webknossos/pull/10025)

  ![segments tab](https://static.webknossos.org/assets/release_notes/segments-tab_changelog.gif)

[Read the full changelog](https://github.com/scalableminds/webknossos/releases)
