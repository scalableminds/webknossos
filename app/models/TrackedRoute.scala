package models

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Mode
import play.api.Configuration
import play.api.Play.current
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import java.util.Date
import scala.math._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 22:07
 */
case class TrackedRoute(
    userId: ObjectId,
    binaryPointTree: Array[Byte] = Array(),
    first: List[Int],
    last: List[Int],
    closed: Boolean = false,
    timestamp: Date = new Date,
    _id: ObjectId = new ObjectId ) {

  def points = Array[Vector3I]( first ) ++ TrackedRoute.byteCodesToRoute( first, binaryPointTree )

  def add( newPoints: List[Vector3I] ) = {
    if ( newPoints.size > 0 ) {
      val modifiedRoute = this.copy(
        binaryPointTree = binaryPointTree ++ TrackedRoute.routeToByteCodes( last, newPoints ),
        last = newPoints.last )
      TrackedRoute.save( modifiedRoute )
      modifiedRoute
    }
  }

  def addBranch() = {
    val modifiedRoute = this.copy( binaryPointTree = binaryPointTree :+ TrackedRoute.BranchByteCode )
    TrackedRoute.save( modifiedRoute )
    modifiedRoute
  }

  def closeBranch( nextBranch: Vector3I ) = {
    val modifiedRoute = this.copy(
      binaryPointTree = binaryPointTree :+ TrackedRoute.EndByteCode,
      last = nextBranch )
    TrackedRoute.save( modifiedRoute )
    modifiedRoute
  }
}

object TrackedRoute extends BasicDAO[TrackedRoute]( "routes" ) {

  val ValueByteCode = 0x00.toByte
  val BranchByteCode = 0x80.toByte
  val EndByteCode = 0xC0.toByte

  def byteCodeToInt( b: Int ): Int = b - 1

  def isValueByte( b: Byte ): Boolean = ( b & 0xC0 ) == ValueByteCode.toInt

  def intToByteCode( i: Int ): Byte = {
    assert( i > -2 && i < 2, "Assertion failed with: " + i )
    ( i + 1 ).toByte
  }

  def byteCodeToPoint( byte: Int ): List[Int] = {
    val xMask = 0x30.toByte
    val yMask = 0x0C.toByte
    val zMask = 0x03.toByte
    List( byteCodeToInt( byte & xMask ), byteCodeToInt( byte & yMask ), byteCodeToInt( byte & zMask ) )
  }

  def fillGaps( s: Vector3I, e: Vector3I ): List[Vector3I] = {
    var dx = s.x - e.x
    var dy = s.y - e.y
    var dz = s.z - e.z

    val maxSize = max( dx.abs, max( dy.abs, dz.abs ) )

    if ( maxSize > 5 )
      log.warn( "Huge gap! Size: %d".format( maxSize ) )

    val xList = List.fill( dx.abs )( dx.signum ) ::: List.fill( maxSize - dx.abs )( 0 )
    val yList = List.fill( dy.abs )( dy.signum ) ::: List.fill( maxSize - dy.abs )( 0 )
    val zList = List.fill( dz.abs )( dz.signum ) ::: List.fill( maxSize - dz.abs )( 0 )

    List( xList, yList, zList ).transpose.map( IntListToVector3I )
  }

  def pointToByteCode( point: Vector3I ): Byte =
    ( ValueByteCode |
      ( intToByteCode( point.x ) << 4 |
        intToByteCode( point.y ) << 2 |
        intToByteCode( point.z ) ) ).toByte

  def routeToByteCodes( start: Vector3I, points: List[Vector3I] ): Array[Byte] = {
    points.zip( start :: points ).flatMap {
      case ( p, s ) =>
        fillGaps( s, p ).map( pointToByteCode )
    }.toArray
  }

  def byteCodesToRoute( start: Vector3I, bytes: Array[Byte] ): Array[Vector3I] = {
    var previous = start
    for {
      b <- bytes
      if isValueByte( b )
    } yield {
      previous = previous - byteCodeToPoint( b )
      previous
    }
  }

  def createForUser( user: User, points: List[Vector3I] = Nil ) = {
    closeOpenRoutesBy( user )
    val b: Array[Byte] = Array()
    val route = TrackedRoute(
      user._id,
      routeToByteCodes( points.head, points.slice( 1, points.size ) ),
      points.head,
      points.last )
    insert( route )
    route
  }

  def closeOpenRoutesBy( user: User ) {
    if ( Play.maybeApplication.map( _.mode ).getOrElse( Mode.Dev ) == Mode.Prod )
      update(
        MongoDBObject( "userId" -> user._id, "closed" -> false ),
        $set( "closed" -> true ), false, true )
  }

  def findOpenBy( id: String ): Option[TrackedRoute] = {
    find(
      MongoDBObject( "_id" -> new ObjectId( id ), "closed" -> false ) ).toList.headOption
  }

  def findOpenBy( user: User ): Option[TrackedRoute] = {
    find(
      MongoDBObject( "userId" -> user._id, "closed" -> false ) ).toList.headOption
  }
}