// @flow

// Adapted from https://github.com/tuzz/n-dimensional-flood-fill
// This floodfill is highly customized to work well for the automatic brush feature.
// It's a forward-only 3D floodfill that will first fill a whole 2d slice, then call onFlood
// with the result, and then go on and fill the next 2d slice.

type Vector3 = [number, number, number];

type FloodfillOptions = {
  getter: (number, number, number) => Promise<boolean>,
  seed: Vector3,
  onFlood: (Array<Vector3>) => Promise<void>,
};

export default function(options: FloodfillOptions) {
  const noop = () => {};

  const { getter, seed } = options;
  const onFlood = options.onFlood || noop;
  // Disallow negative z
  const permutations: Array<Vector3> = [[-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];
  let stack: Array<Vector3> = [];
  let nextStack: Array<Vector3> = [];
  let flooded = [];
  const visits = {};

  const visited = key => visits[key.toString()] === true;

  const markAsVisited = key => {
    visits[key.toString()] = true;
  };

  const member = getArgs => getter(getArgs[0], getArgs[1], getArgs[2]);

  const markAsFlooded = getArgs => {
    flooded.push(getArgs);
  };

  const pushAdjacent = getArgs => {
    for (let i = 0; i < permutations.length; i += 1) {
      const perm = permutations[i];
      const nextArgs = [getArgs[0], getArgs[1], getArgs[2]];

      for (let j = 0; j < getArgs.length; j += 1) {
        nextArgs[j] += perm[j];
      }

      if (perm[2] === 0) {
        stack.push(nextArgs);
      } else {
        // Push permutations for the next z-slice to a separate stack
        nextStack.push(nextArgs);
      }
    }
  };

  const flood = async getArgs => {
    if (visited(getArgs)) {
      return;
    }
    markAsVisited(getArgs);

    if (await member(getArgs)) {
      markAsFlooded(getArgs);
      pushAdjacent(getArgs);
    }
  };

  const main = async () => {
    stack.push(seed);

    while (stack.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await flood(stack.pop());

      if (stack.length === 0) {
        // eslint-disable-next-line no-await-in-loop
        await onFlood(flooded);
        stack = nextStack;
        nextStack = [];
        flooded = [];
      }
    }
  };

  return main();
}
