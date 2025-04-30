/**
 * Type definitions for package javascript-natural-sort
 * https://github.com/Bill4Time/javascript-natural-sort
 */

/**
 * A natural sort comparison function that sorts strings containing numbers in a human-friendly way.
 * Examples:
 * - "file1.txt" < "file2.txt" < "file10.txt" (instead of "file1.txt" < "file10.txt" < "file2.txt")
 * - "version1.0" < "version1.2" < "version1.10" (instead of "version1.0" < "version1.10" < "version1.2")
 *
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns -1 if a < b, 1 if a > b, 0 if a == b
 */
declare function naturalSort(a: any, b: any): -1 | 0 | 1;

/**
 * Additional properties for the naturalSort function
 */
interface NaturalSortFunction {
  (a: any, b: any): -1 | 0 | 1;
  /**
   * When true, comparisons are case-insensitive
   */
  insensitive: boolean;
}

// Add the insensitive property to the function type
declare const naturalSortWithProps: NaturalSortFunction;

// Export the function with its properties
export = naturalSortWithProps; 