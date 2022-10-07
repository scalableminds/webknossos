declare module "n-dimensional-flood-fill" {
  // These typings might need generalization and were only written
  // to satisfy TS for now.
  type Opts = {
    getter: (...args: Array<number>) => number | bigint | null;
    seed: Array<number>;
    equals: (a: number, b: number) => boolean;
    onFlood: (...args: Array<number>) => void;
  };

  export default function floodfill(opt: Opts);
}
