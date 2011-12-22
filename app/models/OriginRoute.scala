package models

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
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
case class PosDir(position: Vector3D, direction: Vector3D)

case class OriginPosDir(porection: PosDir, usedCount: Int, _id: ObjectId = new ObjectId)

object OriginPosDir extends BasicDAO[OriginPosDir]("origins") {
  def leastUsed = {
    val origin = find(MongoDBObject()).sort(orderBy = MongoDBObject("usedCount" -> 1)).limit(1).toList
    if (origin.size > 0)
      origin.head
    else
      null
  }

  def incUsed(obj: OriginPosDir) {
    update(MongoDBObject("_id" -> obj._id), $inc("usedCount" -> 1))
  }

  def findAll = find(MongoDBObject.empty).toList
}