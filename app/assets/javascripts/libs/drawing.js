import Utils from "libs/utils";

// This is a class with static methods and constants dealing with drawing
// lines and filling polygons

// Macros
// Constants
const SMOOTH_LENGTH = 4;
const SMOOTH_ALPHA = 0.2;

const Drawing = {

  // Source: http://en.wikipedia.org/wiki/Bresenham's_line_algorithm#Simplification
  drawLine2d(x, y, x1, y1, draw) {
    let d;
    let mode;
    let dx = x1 - x;
    let dy = y1 - y;
    let incX = dx < 0 ? -1 : 1;
    let incY = dy < 0 ? -1 : 1;

    dx = Math.abs(dx);
    dy = Math.abs(dy);

    let dx2 = dx << 1;
    let dy2 = dy << 1;

    draw(x, y);

    if (dx >= dy) {
      d = dx;
      mode = 0;
    } else {
      // swapMacro(y, x)
      let tmp = y;
      y = x;
      x = tmp;

      // swapMacro(incY, incX)
      tmp = incY;
      incY = incX;
      incX = tmp;

      // swapMacro(dy2, dx2)
      tmp = dy2;
      dy2 = dx2;
      dx2 = tmp;

      d = dy;
      mode = 1;
    }

    let err = dy2 - d;

    for (let i = 0; i < d; i++) {
      if (err > 0) {
        y += incY;
        err -= dx2;
      }

      err += dy2;
      x += incX;

      if (mode) {
        draw(y, x);
      } else {
        draw(x, y);
      }
    }
  },


  addNextLine(newY, isNext, downwards, minX, maxX, r, ranges, test, paint) {
    let rMinX = minX;
    let inRange = false;
    let x = minX;

    while (x <= maxX) {
      // skip testing, if testing previous line within previous range
      const empty = (isNext || (x < r[0] || x > r[1])) && test(x, newY);
      if (!inRange && empty) {
        rMinX = x;
        inRange = true;
      } else if (inRange && !empty) {
        ranges.push([rMinX, x - 1, newY, downwards, rMinX === minX, false]);
        inRange = false;
      }
      if (inRange) { paint(x, newY); }

      // skip
      if (!isNext && x === r[0]) { x = r[1]; }
      x++;
    }
    if (inRange) { ranges.push([rMinX, x - 1, newY, downwards, rMinX === minX, true]); }
  },


  // Source: http://will.thimbleby.net/scanline-flood-fill/
  fillArea(x, y, width, height, diagonal, test, paint) {
    // xMin, xMax, y, down[true] / up[false], extendLeft, extendRight
    const ranges = [[x, x, y, null, true, true]];
    paint(x, y);
    while (ranges.length) {
      const r = ranges.pop();
      let minX = r[0];
      let maxX = r[1];
      y = r[2];
      const down = r[3] === true;
      const up = r[3] === false;
      const extendLeft = r[4];
      const extendRight = r[5];
      if (extendLeft) {
        while (minX > 0 && test(minX - 1, y)) {
          minX--;
          paint(minX, y);
        }
      }
      if (extendRight) {
        while (maxX < width - 1 && test(maxX + 1, y)) {
          maxX++;
          paint(maxX, y);
        }
      }
      if (diagonal) {
        if (minX > 0) { minX--; }
        if (maxX < width - 1) { maxX++; }
      } else {
        r[0]--;
        r[1]++;
      }
      if (y < height) { this.addNextLine(y + 1, !up, true, minX, maxX, r, ranges, test, paint); }
      if (y > 0) { this.addNextLine(y - 1, !down, false, minX, maxX, r, ranges, test, paint); }
    }
  },


  // Source : http://twistedoakstudios.com/blog/Post3138_mouse-path-smoothing-for-jack-lumber
  smoothLine(points, callback) {
    const smoothLength = this.smoothLength || SMOOTH_LENGTH;
    const a = this.alpha || SMOOTH_ALPHA;

    if (points.length > 2 + smoothLength) {
      for (const i of Utils.__range__(0, smoothLength, false)) {
        const j = points.length - i - 2;
        const p0 = points[j];
        const p1 = points[j + 1];

        const p = [];
        for (const k of Utils.__range__(0, p0.length, false)) {
          p.push((p0[k] * (1 - a)) + (p1[k] * a));
        }

        callback(p);
        points[j] = p;
      }
    }

    return points;
  },


  setSmoothLength(v) { this.smoothLength = v; },
  setAlpha(v) { this.alpha = v; },

};

export default Drawing;
