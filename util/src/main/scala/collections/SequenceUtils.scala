package collections

object SequenceUtils {
  def findUniqueElement[T](list: Seq[T]): Option[T] = {
    val uniqueElements = list.distinct
    if (uniqueElements.length == 1) uniqueElements.headOption
    else None
  }
}
