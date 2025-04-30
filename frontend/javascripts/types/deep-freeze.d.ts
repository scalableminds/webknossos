/**
 * Type definitions for package javascript-natural-sort
 * https://github.com/Bill4Time/javascript-natural-sort
 */

/**
 * Recursively Object.freeze() on objects and functions
 * 
 * Freezes an object and all its properties deeply making the entire
 * object hierarchy immutable. Once frozen, you can no longer add,
 * remove or change any properties of the object.
 * 
 * @param o - The object to freeze
 * @returns The same object, but frozen
 */
declare function deepFreeze<T>(o: T): Readonly<T>;

export = deepFreeze; 