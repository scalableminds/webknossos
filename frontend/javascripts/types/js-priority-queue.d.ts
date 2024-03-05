declare module "js-priority-queue" {
  declare class PriorityQueue<T> {
    length: number;
    constructor(
      options?: Partial<{
        comparator: (arg0: T, arg1: T) => number;
        initialValues: Array<T>;
      }>,
    );
    queue(value: T): void;
    peek(): T;
    dequeue(): T;
    clear(): void;
  }
  export default PriorityQueue;
}
