// This module contains helpers methods for working with IteratorsObjects
// i.e. Map.keys(), Set.values(), etc.

/**
 * Returns the maximum value in the iterator
 * @param iterator - Iterator of numbers
 * @returns Maximum value in the iterator or null if empty
 */
export function max<T extends number>(iterator: IteratorObject<T>): number | null {
  const maxValue = iterator.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  return maxValue !== Number.NEGATIVE_INFINITY ? maxValue : null;
}

/**
 * Returns the minimum value in the iterator
 * @param iterator - Iterator of numbers
 * @returns Minimum value in the iterator or null if empty
 */
export function min<T extends number>(iterator: IteratorObject<T>): number | null {
  const minValue = iterator.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  return minValue !== Number.POSITIVE_INFINITY ? minValue : null;
}

/**
 * Returns the sum of all values in the iterator
 * @param iterator - Iterator of numbers
 * @returns Sum of all values in the iterator or 0 if empty
 */
export function sum<T extends number>(iterator: IteratorObject<T>): number {
  return iterator.reduce((sum, value) => sum + value, 0);
}

/**
 * Returns the object with the maximum value obtained by applying the selector function to each element or
 * by selecting the specified property from each element in the iterator
 * @param iterator - Iterator of objects
 * @param selector - Function or property name to get numeric values from objects
 * @returns The object with maximum selected value or null if empty
 */
export function maxBy<T extends { [key in K]: unknown }, K extends string>(
  iterator: IteratorObject<T>,
  selector: ((value: T) => number) | K,
): T | null {
  const first = iterator.next();
  if (first.done) return null;

  return iterator.reduce((result: T, entry: T) => {
    const entryValue = typeof selector === "string" ? entry[selector] : selector(entry);
    const resultValue = typeof selector === "string" ? result[selector] : selector(result);

    if (entryValue != null && resultValue != null && entryValue > resultValue) {
      return entry;
    }
    return result;
  }, first.value);
}

/**
 * Returns the object with the minimum value obtained by applying the selector function to each element or
 * by selecting the specified property from each element in the iterator
 * @param iterator - Iterator of objects
 * @param selector - Function or property name to get numeric values from objects
 * @returns The object with minimum selected value or null if empty
 */
export function minBy<T extends { [key in K]: unknown }, K extends string>(
  iterator: IteratorObject<T>,
  selector: ((value: T) => number) | K,
): T | null {
  const first = iterator.next();
  if (first.done) return null;

  return iterator.reduce((result: T, entry: T) => {
    const entryValue = typeof selector === "string" ? entry[selector] : selector(entry);
    const resultValue = typeof selector === "string" ? result[selector] : selector(result);

    if (entryValue != null && resultValue != null && entryValue < resultValue) {
      return entry;
    }
    return result;
  }, first.value);
}
