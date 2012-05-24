package models

import scala.collection.mutable.Stack
import scala.collection.immutable.Vector
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
import brainflight.tools.ExtendedTypes._
import scala.math._

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 22:07
 */


case class TreeByte( b: Byte) {
  def isValue = ( b & 0xC0 ) == TreeByte.ValueByte
  def isBranch = ( b & 0xC0 ).toByte == TreeByte.BranchByte
  def isEnd = ( b & 0xC0 ).toByte == TreeByte.EndByte
  def isInterpolated = ( b & 0xC0 ).toByte == TreeByte.InterpolatedByte
  
  def x = TreeByte.byteCodeToInt( (b & TreeByte.xMask) >> 4 )
  def y = TreeByte.byteCodeToInt( (b & TreeByte.yMask) >> 2 )
  def z = TreeByte.byteCodeToInt( b & TreeByte.zMask )
}

object TreeByte {
  implicit def ByteToTreeByte( b: Byte) = TreeByte( b )
  
  val xMask = 0x30
  val yMask = 0x0C
  val zMask = 0x03
  
  val ValueByte = 0x00.toByte
  val PointValue = 0f

  val InterpolatedByte = 0x40.toByte
  
  val BranchByte = 0x80.toByte
  val BranchPushVallue = 1f
  
  val EndByte = 0xC0.toByte
  val BranchPopValue = 2f
  
  def byteCodeToInt( b: Int ): Int = b - 1
}

case class TrackedRoute(
    userId: ObjectId,
    dataSetId: ObjectId,
    binaryPointTree: Array[Byte] = Array(),
    first: List[Int],
    last: List[Int],
    closed: Boolean = false,
    timestamp: Date = new Date,
    _id: ObjectId = new ObjectId ) {

  val id = _id.toString
  
  def points: List[List[Vector3I]] = TrackedRoute.routeFromBinary( start = first, bytes = binaryPointTree )

  def add( newPoints: List[Vector3I] ) = {
    if ( newPoints.size > 0 ) {
      this.copy(
        binaryPointTree = binaryPointTree ++ TrackedRoute.binaryFromRoute( start = last, points = newPoints ),
        last = newPoints.last )
    } else
      this
  }

  def addBranch = 
    this.copy( binaryPointTree = binaryPointTree :+ TreeByte.BranchByte.toByte )

  def closeBranch( nextBranch: Vector3I ) = {
    this.copy(
      binaryPointTree = binaryPointTree :+ TreeByte.EndByte.toByte,
      last = nextBranch )
  }
}

object TrackedRoute extends BasicDAO[TrackedRoute]( "routes" ){
  import TreeByte._
  
  def intToByteCode( i: Int ): Byte = {
    assert( i >= -1 && i <= 1, "Assertion failed with: " + i )
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
        filled.zipWithIndex.map{ 
          case (point, idx) =>
            pointToByteCode( point, idx != filled.size-1 ) 
        }       
    }.toArray
  }

  def routeFromBinary( start: Vector3I, bytes: Array[Byte] ): List[List[Vector3I]] = {
    var previous = start
    val branchPointStack = Stack[Vector3I]()
    var tree: List[List[Vector3I]] = Nil
    var route = Vector[Vector3I]( start )
    for( b <- bytes ){
      b match {
        case b if b.isValue =>
          previous = previous + byteCodeToPoint( b )
          route = route :+ previous
        case b if b.isInterpolated =>
          previous = previous + byteCodeToPoint( b )
        case b if b.isBranch =>
          branchPointStack.push( previous)
          previous
        case b if b.isEnd =>
          previous = branchPointStack.pop()
          tree ::= route.toList
          route = Vector[Vector3I]( previous )
          previous
      }
    }
    if( ! route.isEmpty )
      tree ::= route.toList
    tree
  }

  def createForUser( user: User, dataSetId: String, points: List[Vector3I] = Nil ) = {
    closeOpenRoutesBy( user )
    val b: Array[Byte] = Array()
    val route = TrackedRoute(
      user._id,
      new ObjectId( dataSetId ),
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
  
  def extendRoute( route1: TrackedRoute, user: User, buffer: Array[Byte]) = {
    var points = Vector.empty[Vector3I]
    var routeBuffer = route1    
    var userBuffer = user
    val floatBuffer = buffer.subDivide( 4 ).map( _.reverse.toFloat )
    
    floatBuffer.dynamicSliding( windowSize = 17 ) {
      case PointValue :: x :: y :: z :: _ =>
        val v = Vector3I( x.toInt, y.toInt, z.toInt )
        points = points :+ v
        
        Vector3I.defaultSize
      case BranchPushVallue :: tail =>
        val matrix = tail.take(16)
        
        userBuffer = userBuffer.copy( branchPoints = BranchPoint( matrix ) :: userBuffer.branchPoints )
        routeBuffer = routeBuffer.add( points.toList ).addBranch
        points = Vector.empty
        
        TransformationMatrix.defaultSize
      case BranchPopValue :: _ =>
        routeBuffer = routeBuffer.add( points.toList )
        points = Vector.empty
        if ( !userBuffer.branchPoints.isEmpty ) {
          val branchPoint = userBuffer.branchPoints.head
          userBuffer = userBuffer.copy( branchPoints = userBuffer.branchPoints.tail ) 
          routeBuffer = routeBuffer.closeBranch( branchPoint.matrix.extractTranslation.get.toVector3I )
        }
        
        0
      case _ =>
        println("Recieved control code is invalid.")     
        floatBuffer.size // jump right to the end to stop processing
    }
    routeBuffer = routeBuffer.add( points.toList )
    save( routeBuffer )
    User.save( userBuffer )
  }
}