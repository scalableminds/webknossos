package brainflight.tools

import java.nio.ByteBuffer
import scala.math._
import brainflight.tools.Math._
import scala.collection.mutable.ListBuffer
import com.mongodb.casbah.gridfs.Imports._
import extendedTypes._

/**
 * Helper object so simplify the include of the implicits. Every new 
 * extended Type should declare an implicit here if it should be in scope by
 * default.
 */
object ExtendedTypes {

  implicit def GridFSDBFile2ExtendedGridFSDBFile( f: GridFSDBFile ) =
    new ExtendedGridFSDBFile( f )
  
  // --------------------------------------------------------------------------

  implicit def ByteArray2ExtendedByteArray( b: Array[Byte] ) =
    new ExtendedByteArray( b )

  // --------------------------------------------------------------------------

  implicit def Int2ExtendedInt( i: Int ) =
    new ExtendedInt( i )
  
  // --------------------------------------------------------------------------

  implicit def String2ExtendedString( s: String ) =
    new ExtendedString( s )
  // --------------------------------------------------------------------------

  implicit def Float2ExtendedFloat( f: Float ) =
    new ExtendedFloat( f )

  // --------------------------------------------------------------------------

  implicit def Dobule2ExtendedDouble( d: Double ) =
    new ExtendedDouble( d )

  // --------------------------------------------------------------------------

  implicit def Array2ExtendedArray[A]( a: Array[A] ) =
    new ExtendedArray( a )
}