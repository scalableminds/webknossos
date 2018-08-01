# Tracing UI

## Overview
The main webKnossos user interface for viewing and annotating datasets is divided into four sections.
1. A toolbar for general purposes features such as Saving your work and displaying the current position within the dataset spans along the full width on top of the screen. More below.
2. On the left-hand side, a settings menu gives the user control of several parameters of webKossso. For instance, one can fine-tune a dataset's contrast & segmentation opacity, as well as adjust movement speed of the mouse and keyboard. More below.
3. The center of the screen is occupied by the tracing interface. Your dataset is displayed here and users can add annotations or add/edit the segmentation. Most interactions we take place here. More below.
4. The right-hand side of the screen is occupied by several tabs providing more information on your current dataset or tracing. Depending on your editing mode these tabs might change. More below.

TODO Add image

## The Tool Bar
The toolbar contains frequently used commands, your current position within the dataset and the ability to switch between various modes for viewing and interaction with the dataset or tools depending on your tracing mode.

The most common buttons are:
- `Settings`: Toggles the visibility of the setting menu on the left-hand side to make more space for your data.
- `Undo` / `Redo`: Undoes the last operation or redoes it if now changes have been made in the meantime.
- `Save`: Saves your annotation work. wK automatically saves every 30 seconds.
- `Archive`: Only available for explorative tracings. Closes the tracing and archives it, removing it from a user's dashboard. Archived tracings can be found on a user's dashboard under "Explorative Tracings" and by clicking on "Show Archived Annotations". Use this to declutter your dashboard. 
- `Download`: Starts the download of the current annotation. Skeletontracings are downloaded as NML files. Volumetracing downloads contain the raw segmentation data as wkw files.
- `Share`: Create a shareable link to your dataset containing the current position, rotation, zoom level etc. Use this to collaboratively work with colleagues. Read more about this feature in the [Sharing guide](./sharing.md).  
- `Add Script`: Using the [wK frontend API](https://demo.webknossos.org/assets/docs/frontend-api/index.html)] user can interact with wK programmatically. User script can be executed from here. Admins can add often used scripts to wK to make them available to all users for easy access.

A user can directly jump to positions within their datasets by entering them in the position input field. The same is true for the rotation in some tracing modes. Clicking on the position or rotation labels copies the values to the clipboard.

TODO Add image

## Skeleton Tracing
- what are skeleton tracings?

### Tracing Modes
- Orthogonal Mode
- Flight
- Arbitrary

### Nodes and Trees
- Skeletons are trees
- Adding / Deleting / Merge / Split Nodes / Trees
- Active Node
- keyboard shortcuts
- abstract tree viewer
- renaming

### Tree Groups
- Rename, adding, delelte
- drag & drop
- hiding trees

### Comments


### Importing & Exporting NML Files
- drag and drop
- buttons
- download

### Merging Tracings
- drag and drop
- dialogs


## Volume Tracing
- what are volume tracings
- tools
  - brush, move, selection
- adding / deleting segmentation
- keyboard shortcuts
- segementation tab


## Tracing Settings
- short intro to each setting
