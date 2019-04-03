// @noflow
/* eslint-disable eslint-comments/no-unlimited-disable */
/* eslint-disable */

// Adapted from https://github.com/tuzz/n-dimensional-flood-fill

export default function(options) {
  var getter, seed, onFlood, onBoundary, diagonals, permutations, stack, flooded, visits, bounds;

  var initialize = function() {
    getter = options.getter;
    seed = options.seed;
    onFlood = options.onFlood || noop;
    onBoundary = options.onBoundary || noop;
    diagonals = options.diagonals || false;
    permutations = prunedPermutations();
    stack = [];
    flooded = [];
    visits = {};
    bounds = {};
  };

  var main = async function() {
    stack.push({ currentArgs: seed });

    while (stack.length > 0) {
      await flood(stack.pop());
    }

    return {
      flooded: flooded,
      // boundaries: boundaries(),
    };
  };

  var flood = async function(job) {
    var getArgs = job.currentArgs;
    var prevArgs = job.previousArgs;

    if (visited(getArgs)) {
      return;
    }
    markAsVisited(getArgs);

    if (await member(getArgs)) {
      markAsFlooded(getArgs);
      pushAdjacent(getArgs);
    } else {
      // markAsBoundary(prevArgs);
    }
  };

  var visited = function(key) {
    return visits[key] === true;
  };

  var markAsVisited = function(key) {
    visits[key] = true;
  };

  var member = function(getArgs) {
    return getter(getArgs[0], getArgs[1], getArgs[2]);
  };

  var markAsFlooded = function(getArgs) {
    flooded.push(getArgs);
    onFlood(getArgs[0], getArgs[1], getArgs[2]);
  };

  var markAsBoundary = function(prevArgs) {
    bounds[prevArgs] = prevArgs;
    onBoundary.apply(undefined, prevArgs);
  };

  var pushAdjacent = function(getArgs) {
    for (var i = 0; i < permutations.length; i += 1) {
      var perm = permutations[i];
      var nextArgs = getArgs.slice(0);

      for (var j = 0; j < getArgs.length; j += 1) {
        nextArgs[j] += perm[j];
      }

      stack.push({
        currentArgs: nextArgs,
        previousArgs: getArgs,
      });
    }
  };

  var noop = function() {};

  var prunedPermutations = function() {
    var permutations = permute(seed.length);

    return permutations.filter(function(perm) {
      var count = countNonZeroes(perm);
      return count !== 0 && (count === 1 || diagonals);
    });
  };

  var permute = function(length) {
    var perms = [];

    var permutation = function(string) {
      return string.split("").map(function(c) {
        return parseInt(c, 10) - 1;
      });
    };

    for (var i = 0; i < Math.pow(3, length); i += 1) {
      var string = lpad(i.toString(3), "0", length);
      perms.push(permutation(string));
    }

    return perms;
  };

  var lpad = function(string, character, length) {
    var array = new Array(length + 1);
    var pad = array.join(character);
    return (pad + string).slice(-length);
  };

  var countNonZeroes = function(array) {
    var count = 0;

    for (var i = 0; i < array.length; i += 1) {
      if (array[i] !== 0) {
        count += 1;
      }
    }

    return count;
  };

  var boundaries = function() {
    var array = [];

    for (var key in bounds) {
      if (bounds.hasOwnProperty(key)) {
        array.unshift(bounds[key]);
      }
    }

    return array;
  };

  initialize();
  return main();
}
