package models

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Play.current
import brainflight.tools.geometry.Vector3D

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 22:07
 */
abstract class Origin {
  def matrix: TransformationMatrix
}

case class RouteOrigin(
  matrix: TransformationMatrix,
  usedCount: Int,
  dataSetId: ObjectId,
  _id: ObjectId = new ObjectId ) extends Origin

object RouteOrigin extends BasicDAO[RouteOrigin]( "routeOrigins" ) {
  
  def useLeastUsed( dataSetId: String ) = {
    val origin = find( MongoDBObject( "dataSetId" -> new ObjectId(dataSetId) ) )
      .sort( orderBy = MongoDBObject( "usedCount" -> 1 ) )
      .limit( 1 )
      .toList

    origin.headOption.map { origin =>
      update( MongoDBObject( "_id" -> origin._id ), $inc( "usedCount" -> 1 ) )
      origin
    }
  }
}