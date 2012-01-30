package brainflight.tools

import java.nio.ByteBuffer
import brainflight.tools.Math._
import scala.collection.mutable.ListBuffer

object ExtendedDataTypes {
	implicit def ByteArray2ExtendedByteArray( b: Array[Byte]) = 
	  new ExtendedByteArray( b )
	
	class ExtendedByteArray(b: Array[Byte]){
		def toFloat = {
		    ByteBuffer.wrap( b ).getFloat
		}
		
	  def subDivide( subCollectionSize: Int ): Array[Array[Byte]] = {
	    if(b.size == 0){
	      new Array(0)
	    } else if ( b.length <= subCollectionSize ) {
	      Array(b)
	    } else {
	      var result = new Array[Array[Byte]]( (b.size / subCollectionSize).ceil.toInt)
	      for ( i <- 0 until b.size by subCollectionSize ) {
	        result.update(i/subCollectionSize, b.slice( i, i + subCollectionSize ))
	      }
	      result
	    }
	  }
	}
	implicit def Int2ExtendedInt( i: Int) =
	  new ExtendedInt( i )
	
	class ExtendedInt( i: Int) {
	  def toBinary = {
	    val result = new Array[Byte]( 4 )
	    ByteBuffer.wrap( result ).putInt( i )
	    result
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
	  
	  def toBinary = {
	    val result = new Array[Byte]( 8 )
	    ByteBuffer.wrap( result ).putDouble( d )
	    result
	  }
	}
}