package brainflight.tools.extendedTypes

class ExtendedArray[A]( array: Array[A] ) {

  def dynamicSliding( windowSize: Int )( f: List[A] => Int ) {
    val iterator = array.sliding( windowSize, 1 )
    while ( iterator.hasNext ) {
      val steps = f( iterator.next().toList )
      iterator.drop( steps )
    }
  }
}