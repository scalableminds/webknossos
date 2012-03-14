package brainflight.tools

import java.nio.ByteBuffer
import scala.math._
import brainflight.tools.Math._
import scala.collection.mutable.ListBuffer
import com.mongodb.casbah.gridfs.Imports._

object ExtendedDataTypes {
  
  implicit def GridFSDBFile2ExtendedGridFSDBFile(f: GridFSDBFile) ={
    new ExtendedGridFSDBFile(f)
  }
  
  class ExtendedGridFSDBFile(f: GridFSDBFile){
    def sourceWithCodec(codec: scala.io.Codec) = {
      scala.io.Source.fromInputStream(f.inputStream)(scala.io.Codec.ISO8859)
    }
  }

  implicit def ByteArray2ExtendedByteArray( b: Array[Byte] ) =
    new ExtendedByteArray( b )

  class ExtendedByteArray( b: Array[Byte] ) {
    def toFloat = {
      if ( b != null && b.size == 4 )
        ByteBuffer.wrap( b ).getFloat
      else
        Float.NaN
    }

    def subDivide( subCollectionSize: Int ): Array[Array[Byte]] = b.size match {
      case 0 =>
        new Array( 0 )
      case s if s <= subCollectionSize =>
        Array( b )
      case _ =>
        val arraySize =
          if ( b.size % subCollectionSize == 0 )
            b.size / subCollectionSize
          else
            b.size / subCollectionSize + 1

        val fragments = new Array[Array[Byte]]( arraySize )

        for ( i <- 0 until b.size by subCollectionSize ) {
          val subCollection = b.slice( i, min( i + subCollectionSize, b.size ) )
          fragments.update( i / subCollectionSize, subCollection )
        }
        fragments
    }
  }

  // --------------------------------------------------------------------------

  implicit def Int2ExtendedInt( i: Int ) =
    new ExtendedInt( i )

  class ExtendedInt( i: Int ) {
    def toBinary = {
      val binary = new Array[Byte]( 4 )
      ByteBuffer.wrap( binary ).putInt( i )
      binary
    }
  }

  // --------------------------------------------------------------------------

  implicit def Float2ExtendedFloat( f: Float ) =
    new ExtendedFloat( f )

  class ExtendedFloat( f: Float ) {
    def toBinary = {
      val binary = new Array[Byte]( 4 )
      ByteBuffer.wrap( binary ).putFloat( f )
      binary
    }
  }

  // --------------------------------------------------------------------------

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
      val binary = new Array[Byte]( 8 )
      ByteBuffer.wrap( binary ).putDouble( d )
      binary
    }
  }

  // --------------------------------------------------------------------------

  implicit def Array2ExtendedArray[A]( a: Array[A] ) =
    new ExtendedArray( a )

  class ExtendedArray[A]( array: Array[A] ) {

    def dynamicSliding( windowSize: Int )( f: List[A] => Int ) {
      val iterator = array.sliding( windowSize, 1 )
      while ( iterator.hasNext ) {
        val steps = f( iterator.next().toList )
        iterator.drop( steps )
      }
    }
  }
}