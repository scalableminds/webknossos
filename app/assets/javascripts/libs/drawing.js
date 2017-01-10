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
    let dx;
    let dy;
    let mode;
    let incX = (dx = x1 - x) < 0 ? -1 : 1;
    let incY = (dy = y1 - y) < 0 ? -1 : 1;

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


  // Source: http://will.thimbleby.net/scanline-flood-fill/
  fillArea(x, y, width, height, diagonal, test, paint) {
    // xMin, xMax, y, down[true] / up[false], extendLeft, extendRight
    const ranges = [[x, x, y, null, true, true]];
    paint(x, y);
    return (() => {
      const result = [];
      while (ranges.length) {
        let item;
        const addNextLine = function (newY, isNext, downwards) {
          let rMinX = minX;
          let inRange = false;
          x = minX;

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
          if (inRange) { return ranges.push([rMinX, x - 1, newY, downwards, rMinX === minX, true]); }
        };


        let r = ranges.pop();
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
        if (y < height) { addNextLine(y + 1, !up, true); }
        if (y > 0) { item = addNextLine(y - 1, !down, false); }
        result.push(item);
      }
      return result;
    })();
  },


  // Source : http://twistedoakstudios.com/blog/Post3138_mouse-path-smoothing-for-jack-lumber
  smoothLine(points, callback) {
    const smoothLength = this.smoothLength || SMOOTH_LENGTH;
    const a = this.alpha || SMOOTH_ALPHA;

    if (points.length > 2 + smoothLength) {
      for (const i of __range__(0, smoothLength, false)) {
        const j = points.length - i - 2;
        const p0 = points[j];
        const p1 = points[j + 1];

        const p = [];
        for (const k of __range__(0, p0.length, false)) {
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

function __range__(left, right, inclusive) {
  const range = [];
  const ascending = left < right;
  const end = !inclusive ? right : ascending ? right + 1 : right - 1;
  for (let i = left; ascending ? i < end : i > end; ascending ? i++ : i--) {
    range.push(i);
  }
  return range;
}
