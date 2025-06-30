package com.scalableminds.util.collections

object SequenceUtils {
  def findUniqueElement[T](list: Seq[T]): Option[T] = {
    val uniqueElements = list.distinct
    if (uniqueElements.length == 1) uniqueElements.headOption
    else None
  }

  /*
   Split a list into n parts, isolating the elements that satisfy the given predicate.
   Those elements will be in single-item lists
   Example:
     splitAndIsolate(List(1,2,3,4,5,6,7))(i => i == 4)
       → List(List(1, 2, 3), List(4), List(5, 6, 7))
     splitAndIsolate(List(1,2,3,4,5,6,7))(i => i % 3 == 0)
       → List(List(1, 2), List(3), List(4, 5), List(6), List(7))
     splitAndIsolate(List(1,2,3,4,5,6,7))(i => i > 1000) # no matches → no splitting
       → List(List(1, 2, 3, 4, 5, 6, 7))
     splitAndIsolate(List())(i => true) # empty list stays empty
       → List()
   */
  def splitAndIsolate[T](list: List[T])(predicate: T => Boolean): List[List[T]] =
    list
      .foldLeft(List[List[T]]()) { (acc, item) =>
        if (predicate(item)) {
          List.empty :: List(item) :: acc
        } else {
          acc match {
            case head :: tail => (item :: head) :: tail
            case Nil          => List(List(item))
          }
        }
      }
      .filter(_.nonEmpty) // Remove empty lists. We create one in case the last element satisfies the predicate.
      .reverse // we prepended on the outer list (for perf reasons)
      .map(_.reverse) // we prepended on the inner lists (for perf reasons)

  /*
   Create a Seq of Long range tuples, covering a given inclusive Long range.
   The individual ranges should be treated as inclusive as well.
   Example:
     batchRangeInclusive(0,5,3)
       → Seq((0,2), (3,5))
     batchRangeInclusive(0,6,2)
       → Seq((0,1), (2,3), (4,5), (6,6))
   */
  def batchRangeInclusive(from: Long, to: Long, batchSize: Long): Seq[(Long, Long)] =
    (0L to ((to - from) / batchSize)).map { batchIndex =>
      val batchFrom = batchIndex * batchSize + from
      val batchTo = Math.min(to, (batchIndex + 1) * batchSize + from - 1)
      (batchFrom, batchTo)
    }
}
