package models

import scala.collection.mutable.{ Stack, Queue }
import com.mongodb.casbah.Imports._
import models.context._
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


case class TreeByte( b: Byte) {
  def isValue = ( b & 0xC0 ) == TreeByte.ValueByte.toInt
  def isBranch = ( b & 0xC0 )  == TreeByte.BranchByte.toInt
  def isEnd = ( b & 0xC0 ) == TreeByte.EndByte.toInt
  def isInterpolated = ( b & 0xC0 ) == TreeByte.InterpolatedByte.toInt
  
  def x = TreeByte.byteCodeToInt(b & TreeByte.xMask >> 4)
  def y = TreeByte.byteCodeToInt(b & TreeByte.yMask >> 2)
  def z = TreeByte.byteCodeToInt(b & TreeByte.zMask)
}

object TreeByte {
  implicit def ByteToTreeByte( b: Byte) = TreeByte( b )
  
  val xMask = 0x30.toByte
  val yMask = 0x0C.toByte
  val zMask = 0x03.toByte
  
  val ValueByte = 0x00.toByte
  val InterpolatedByte = 0x40.toByte
  val BranchByte = 0x80.toByte
  val EndByte = 0xC0.toByte
  
  def byteCodeToInt( b: Int ): Int = b - 1
}

case class TrackedRoute(
    userId: ObjectId,
    binaryPointTree: Array[Byte] = Array(),
    first: List[Int],
    last: List[Int],
    closed: Boolean = false,
    timestamp: Date = new Date,
    _id: ObjectId = new ObjectId ) {

  def points = Array[Vector3I]( first ) ++ TrackedRoute.routeFromBinary( start = first, bytes = binaryPointTree )

  def add( newPoints: List[Vector3I] ) = {
    if ( newPoints.size > 0 ) {
      val modifiedRoute = this.copy(
        binaryPointTree = binaryPointTree ++ TrackedRoute.binaryFromRoute( start = last, points = newPoints ),
        last = newPoints.last )
        
      TrackedRoute.save( modifiedRoute )
      modifiedRoute
    }
  }

  def addBranch() = {
    val modifiedRoute = this.copy( binaryPointTree = binaryPointTree :+ TreeByte.BranchByte )
    TrackedRoute.save( modifiedRoute )
    modifiedRoute
  }

  def closeBranch( nextBranch: Vector3I ) = {
    val modifiedRoute = this.copy(
      binaryPointTree = binaryPointTree :+ TreeByte.EndByte,
      last = nextBranch )
    TrackedRoute.save( modifiedRoute )
    modifiedRoute
  }
}

object TrackedRoute extends BasicDAO[TrackedRoute]( "routes" ) {
  import TreeByte._

  
  def intToByteCode( i: Int ): Byte = {
    assert( i > -2 && i < 2, "Assertion failed with: " + i )
    ( i + 1 ).toByte
  }

  def byteCodeToPoint( byte: TreeByte ) = List( byte.x, byte.y, byte.z )

  def pointToByteCode( point: Vector3I, isInterpolated: Boolean ): Byte = {
    val controlByte = if(isInterpolated) InterpolatedByte else ValueByte
    ( controlByte |
      ( intToByteCode( point.x ) << 4 |
        intToByteCode( point.y ) << 2 |
        intToByteCode( point.z ) ) ).toByte
  }

  def binaryFromRoute( start: Vector3I, points: List[Vector3I] ): Array[Byte] = {
    points.zip( start :: points ).flatMap {
      case ( current, previous ) =>
        val filled = current.fillGapTill(previous)
        filled.zipWithIndex.map( tuple =>
          pointToByteCode( tuple._1, tuple._2 != filled.size-1 ) )
    }.toArray
  }

  def routeFromBinary( start: Vector3I, bytes: Array[Byte] ): Array[Vector3I] = {
    var previous = start
    var branchPointStack = Stack[Vector3I]()
    var route = Queue[Vector3I]()
    for( b <- bytes ){
      b match {
        case b if b.isValue =>
          previous = previous + byteCodeToPoint( b )
          route.enqueue(previous)
        case b if b.isInterpolated =>
          previous = previous + byteCodeToPoint( b )
        case b if b.isBranch =>
          branchPointStack.push( previous)
          previous
        case b if b.isEnd =>
          previous = branchPointStack.pop()
          previous
      }
    }
    route.toArray
  }

  def createForUser( user: User, points: List[Vector3I] = Nil ) = {
    closeOpenRoutesBy( user )
    val b: Array[Byte] = Array()
    val route = TrackedRoute(
      user._id,
      binaryFromRoute( points.head, points.slice( 1, points.size ) ),
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
  
  def findByUser( user: User)= {
    find( MongoDBObject( "userId" -> user._id ) ).toList
  }

  def findOpenBy( user: User ): Option[TrackedRoute] = {
    find(
      MongoDBObject( "userId" -> user._id, "closed" -> false ) ).toList.headOption
  }
}