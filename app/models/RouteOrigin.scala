package models

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Play.current
import brainflight.tools.geometry.Vector3D
import brainflight.tools.geometry.TransformationMatrix

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 22:07
 */

case class RouteOrigin(matrix: TransformationMatrix, usedCount: Int, _id: ObjectId = new ObjectId)

object RouteOrigin extends BasicDAO[RouteOrigin]("routeOrigins") {
  def leastUsed = {
    val origin = find(MongoDBObject()).sort(orderBy = MongoDBObject("usedCount" -> 1)).limit(1).toList
    if (origin.size > 0)
      origin.head
    else
      null
  }

  def incUsed(obj: RouteOrigin) {
    update(MongoDBObject("_id" -> obj._id), $inc("usedCount" -> 1))
  }

  def findAll = find(MongoDBObject.empty).toList
}