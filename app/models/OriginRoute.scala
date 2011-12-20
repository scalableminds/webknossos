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
case class LocDir(location: Vector3D, direction: Vector3D)

case class OriginLocDir(lorection: LocDir, usedCount: Int, _id: ObjectId = new ObjectId)

object OriginLocDir extends BasicDAO[OriginLocDir]("origins") {
  def leastUsed = {
    val origin = find(MongoDBObject()).sort(orderBy = MongoDBObject("usedCount" -> 1)).limit(1).toList
    if (origin.size > 0)
      origin.head
    else
      null
  }
}