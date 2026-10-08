import { useMemo } from "react";

const GRID_SIZE = 5;
// Only the left half (including the middle column) is derived from the hash, the right half is mirrored.
const HALF_GRID_SIZE = Math.ceil(GRID_SIZE / 2);

export type IdenticonPattern = {
  hue: number;
  // cells[row][column] is true if that cell is filled
  cells: boolean[][];
};

/** 32-bit FNV-1a hash. Mixes well enough that ids which differ in a single character
 * (e.g. consecutive MongoDB ObjectIds) still yield unrelated patterns. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministically derives a horizontally symmetric 5x5 pattern and a hue from a string. */
export function computeIdenticonPattern(seed: string): IdenticonPattern {
  // Use separate hashes for the cells and the color, so that both vary independently.
  const cellHash = fnv1a(seed);
  const hue = fnv1a(`${seed}#hue`) % 360;

  const cells = Array.from({ length: GRID_SIZE }, (_row, row) =>
    Array.from({ length: GRID_SIZE }, (_column, column) => {
      const sourceColumn = Math.min(column, GRID_SIZE - 1 - column);
      const bitIndex = row * HALF_GRID_SIZE + sourceColumn;
      return ((cellHash >>> bitIndex) & 1) === 1;
    }),
  );

  return { hue, cells };
}

/** A GitHub-style identicon, i.e. a symmetric pixel pattern derived from `seed`. */
export function Identicon({ seed, size }: { seed: string; size: number }) {
  const { hue, cells } = useMemo(() => computeIdenticonPattern(seed), [seed]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Identicon"
    >
      {cells.flatMap((rowCells, row) =>
        rowCells.map((isFilled, column) =>
          isFilled ? (
            <rect
              key={`${row}-${column}`}
              x={column}
              y={row}
              width={1}
              height={1}
              fill={`hsl(${hue}, 65%, 55%)`}
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
