// @flow

// From https://github.com/facebook/flow/issues/4002#issuecomment-384756198
export type ExtractReturn<Fn> = $Call<<T>((...Iterable<any>) => T) => T, Fn>;
