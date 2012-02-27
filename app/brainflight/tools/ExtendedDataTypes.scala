package brainflight.tools

import java.nio.ByteBuffer
import scala.math._
import brainflight.tools.Math._
import scala.collection.mutable.ListBuffer

object ExtendedDataTypes {
  implicit def ByteArray2ExtendedByteArray( b: Array[Byte] ) =
    new ExtendedByteArray( b )

  class ExtendedByteArray( b: Array[Byte] ) {
    def toFloat = {
      if(b != null && b.size == 4)
    	  ByteBuffer.wrap( b ).getFloat
      else
    	  Float.NaN
    }

    def subDivide( subCollectionSize: Int ): Array[Array[Byte]] = {
      if ( b.size == 0 ) {
        new Array( 0 )
      } else if ( b.length <= subCollectionSize ) {
        Array( b )
      } else {
        val arraySize =
          if ( b.size % subCollectionSize == 0 )
            b.size / subCollectionSize
          else
            b.size / subCollectionSize + 1

        val result = new Array[Array[Byte]]( arraySize )

        for ( i <- 0 until b.size by subCollectionSize ) {
          val subCollection = b.slice( i, min( i + subCollectionSize, b.size ) )
          result.update( i / subCollectionSize, subCollection )
        }
        result
      }
    }
  }
  implicit def Int2ExtendedInt( i: Int ) =
    new ExtendedInt( i )

  class ExtendedInt( i: Int ) {
    def toBinary = {
      val result = new Array[Byte]( 4 )
      ByteBuffer.wrap( result ).putInt( i )
      result
    }
  }

  implicit def Float2ExtendedFloat( f: Float ) =
    new ExtendedFloat( f )

  class ExtendedFloat( f: Float ) {
    def toBinary = {
      val result = new Array[Byte]( 4 )
      ByteBuffer.wrap( result ).putFloat( f )
      result
    }
  }

  implicit def Dobule2ExtendedDouble( d: Double ) =
    new ExtendedDouble( d )

  class ExtendedDouble( d: Double ) {

    def patchAbsoluteValue =
      if ( d >= 0 )
        d + EPSILON
      else
        d - EPSILON

    def isNearZero =
      d <= EPSILON && d >= -EPSILON

    def toBinary = {
      val result = new Array[Byte]( 8 )
      ByteBuffer.wrap( result ).putDouble( d )
      result
    }
  }
  
  implicit def Array2ExtendedArray[A]( a: Array[A] ) =
    new ExtendedArray( a )
  
  class ExtendedArray[A]( l: Array[A]) {
    def dynamicSliding( size: Int)( f: List[A] => Int) {
     val iterator = l.sliding(size, 1)
     while( iterator.hasNext ){
       val step = f(iterator.next().toList)
       iterator.drop(step)
     }
    }
  }
}