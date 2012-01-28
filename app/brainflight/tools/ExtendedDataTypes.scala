package brainflight.tools

import java.nio.ByteBuffer
import brainflight.tools.Math._

object ExtendedDataTypes {
	implicit def ByteArray2ExtendedByteArray( b: Array[Byte]) = 
	  new ExtendedByteArray( b )
	
	class ExtendedByteArray(b: Array[Byte]){
		def toFloat = {
		    ByteBuffer.wrap( b ).getFloat
		}
	}
	
	implicit def Array2ExtendedArray[T]( a: Array[T]) = 
	  new ExtendedArray( a )
	
	class ExtendedArray[T]( a: Array[T]){
	  def subDivide( subCollectionSize: Int ): List[Array[T]] = {
	    val numFloatBytes = 4
	    if(a.length == 0){
	      Nil
	    } else if ( a.length <= subCollectionSize ) {
	      a :: Nil
	    } else {
	      var result = List[Array[T]]()
	      for ( i <- 0 until a.length by numFloatBytes ) {
	        result ::= a.slice( i, i + numFloatBytes )
	      }
	      result
	    }
	  }
	}
	
	implicit def Float2ExtendedFloat( f: Float) =
	  new ExtendedFloat( f )
	
	class ExtendedFloat( f: Float) {
	  def toBinary = {
	    val result = new Array[Byte]( 4 )
	    ByteBuffer.wrap( result ).putFloat( f )
	    result
	  }
	}
	
	implicit def Dobule2ExtendedDouble( d: Double) =
	  new ExtendedDouble( d )
	
	class ExtendedDouble( d: Double) {
	  def patchAbsoluteValue = 
	    if( d >= 0 )
	      d + EPSILON
	    else
	      d - EPSILON
	  def nearZero = 
	    d <= EPSILON && d >= -EPSILON
	}
}