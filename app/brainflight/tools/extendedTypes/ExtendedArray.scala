package brainflight.tools.extendedTypes

class ExtendedArray[A]( array: Array[A] ) {

  /**
   * A dynamic sliding window is a sliding window which is moved n steps
   * according to the return value of the passed function.
   */
  def dynamicSliding( windowSize: Int )( f: List[A] => Int ) {
    val iterator = array.sliding( windowSize, 1 )
    while ( iterator.hasNext ) {
      val steps = f( iterator.next().toList )
      iterator.drop( steps )
    }
  }
}