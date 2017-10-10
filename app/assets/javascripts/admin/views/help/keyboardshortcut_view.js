// @flow
import React from "react";

const KeyboardShortcutView = () => (
  <div className="container help">
    <h3>Keyboard Shortcuts</h3>
    <p>Find all available keyboard shortcuts for webKnossos listed below:</p>

    <h3>Orthogonal Mode</h3>
    <table className="table table-hover table-striped">
      <thead>
        <tr>
          <th>Key binding</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Left Mouse drag or Arrow keys</td>
          <td>Move</td>
        </tr>
        <tr>
          <td>I, O or Alt + Mousewheel</td>
          <td>Zoom in/out</td>
        </tr>
        <tr>
          <td>F, D or Mousewheel</td>
          <td>Move along Z-Axis</td>
        </tr>
        <tr>
          <td>Right click</td>
          <td>Set node</td>
        </tr>
        <tr>
          <td>Shift + Alt + Left click</td>
          <td>Merge two trees</td>
        </tr>
        <tr>
          <td>K, L</td>
          <td>Scale up/down viewport size</td>
        </tr>
        <tr>
          <td>B, J</td>
          <td>Set/Jump to last branchpoint</td>
        </tr>
        <tr>
          <td>S</td>
          <td>Center active node</td>
        </tr>
      </tbody>
    </table>

    <h3>3D View</h3>
    <table className="table table-hover table-striped">
      <thead>
        <tr>
          <th>Key binding</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Mousewheel</td>
          <td>Zoom in and out</td>
        </tr>
        <tr>
          <td>Right click drag</td>
          <td>Rotate 3D View</td>
        </tr>
      </tbody>
    </table>

    <h3>General Navigation</h3>
    <table className="table table-hover table-striped">
      <thead>
        <tr>
          <th>Key binding</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Ctrl/Cmd + Z</td>
          <td>Undo</td>
        </tr>
        <tr>
          <td>Ctrl/Cmd + Y</td>
          <td>Redo</td>
        </tr>
        <tr>
          <td>P, N</td>
          <td>Previous/Next comment</td>
        </tr>
        <tr>
          <td>Del</td>
          <td>Delete node/Split trees</td>
        </tr>
        <tr>
          <td>C</td>
          <td>Create new tree</td>
        </tr>
        <tr>
          <td>Shift + Alt + Left click</td>
          <td>Merge two trees</td>
        </tr>
        <tr>
          <td>M</td>
          <td>Toggle mode (Orthogonal, Flight, Oblique)</td>
        </tr>
        <tr>
          <td>1</td>
          <td>Toggle skeleton visibility</td>
        </tr>
        <tr>
          <td>2</td>
          <td>Toggle inactive tree visibility</td>
        </tr>
        <tr>
          <td>3</td>
          <td>Toggle segmentation opacity</td>
        </tr>
        <tr>
          <td>Shift + Mousewheel</td>
          <td>Change node radius</td>
        </tr>
      </tbody>
    </table>

    <h3>Oblique/Flight Mode</h3>
    <table className="table table-hover table-striped">
      <thead>
        <tr>
          <th>Key binding</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Mouse drag or Arrow keys</td>
          <td>Rotation</td>
        </tr>
        <tr>
          <td>Space</td>
          <td>Forward</td>
        </tr>
        <tr>
          <td>Ctrl + Space</td>
          <td>Backward</td>
        </tr>
        <tr>
          <td>I, O</td>
          <td>Zoom in and out</td>
        </tr>
        <tr>
          <td>Shift + Arrow</td>
          <td>Rotation around Axis</td>
        </tr>
        <tr>
          <td>B, J</td>
          <td>Set/Jump to last branchpoint</td>
        </tr>
        <tr>
          <td>R</td>
          <td>Reset rotation</td>
        </tr>
        <tr>
          <td>S</td>
          <td>Center active node</td>
        </tr>
        <tr>
          <td>D</td>
          <td>Forward without recording waypoints</td>
        </tr>
        <tr>
          <td>F</td>
          <td>Backward without recording waypoints</td>
        </tr>
        <tr>
          <td>Shift + Space</td>
          <td>Delete active node, Recenter previous node</td>
        </tr>
      </tbody>
    </table>

    <h3>Volume Mode</h3>
    <table className="table table-hover table-striped">
      <thead>
        <tr>
          <th>Key binding</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Left click</td>
          <td>Set active cell</td>
        </tr>
        <tr>
          <td>Left Mouse drag</td>
          <td>Move (Move mode) / Add to current Cell (Trace mode)</td>
        </tr>
        <tr>
          <td>Arrow keys</td>
          <td>Move</td>
        </tr>
        <tr>
          <td>Shift + Left Mouse drag / Right Mouse drag</td>
          <td>Remove voxels from cell</td>
        </tr>
        <tr>
          <td>C</td>
          <td>Create new cell</td>
        </tr>
        <tr>
          <td>W, 1</td>
          <td>Toggle Move / Trace mode</td>
        </tr>
      </tbody>
    </table>
  </div>
);

export default KeyboardShortcutView;
