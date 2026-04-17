/**
 * Type definitions for package deep-freeze
 * https://github.com/Bill4Time/deep-freeze
 * 
 * Created by AI Agent
 */

declare module 'deep-freeze' {
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
}
