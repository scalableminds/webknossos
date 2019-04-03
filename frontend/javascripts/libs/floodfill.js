// @noflow

// Adapted from https://github.com/tuzz/n-dimensional-flood-fill
// This floodfill is highly customized to work well for the magic wand feature.
// It's a forward-only 3D floodfill that will first fill a whole 2d slice, then call onFlood
// with the result, and then go on and fill the next 2d slice.

export default function(options) {
  const noop = () => {};

  const { getter, seed } = options;
  const onFlood = options.onFlood || noop;
  // Disallow negative z
  const permutations = [[-1, 0, 0], [0, -1, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];
  let stack = [];
  let nextStack = [];
  let flooded = [];
  const visits = {};

  const visited = key => visits[key] === true;

  const markAsVisited = key => {
    visits[key] = true;
  };

  const member = getArgs => getter(getArgs[0], getArgs[1], getArgs[2]);

  const markAsFlooded = getArgs => {
    flooded.push(getArgs);
  };

  const pushAdjacent = getArgs => {
    for (let i = 0; i < permutations.length; i += 1) {
      const perm = permutations[i];
      const nextArgs = getArgs.slice(0);

      for (let j = 0; j < getArgs.length; j += 1) {
        nextArgs[j] += perm[j];
      }

      const fullArgs = {
        currentArgs: nextArgs,
        previousArgs: getArgs,
      };
      if (perm[2] === 0) {
        stack.push(fullArgs);
      } else {
        // Push permutations for the next z-slice to a separate stack
        nextStack.push(fullArgs);
      }
    }
  };

  const flood = async job => {
    const getArgs = job.currentArgs;

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
    stack.push({ currentArgs: seed });

    while (stack.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await flood(stack.pop());

      if (stack.length === 0) {
        onFlood(flooded);
        stack = nextStack;
        nextStack = [];
        flooded = [];
      }
    }
  };

  return main();
}
