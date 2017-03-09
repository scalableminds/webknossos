/**
 * reduce_reducers.js
 * @flow
 */

import Immutable from 'seamless-immutable';

export default function reduceReducers(...reducers: Array<Function>): Function {
  return (previous, current) =>
    reducers.reduce(
      (p, r) => Immutable(r(p, current)),
      Immutable(previous),
    );
};
