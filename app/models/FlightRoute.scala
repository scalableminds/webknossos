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

case class FlightRoute(user_id: ObjectId, points: List[Vector3D] = Nil, _id: ObjectId = new ObjectId)

object FlightRoute extends BasicDAO[FlightRoute]("flightroutes") {
  def createForUser(user_id: ObjectId, points: List[Vector3D] = Nil) = {
    val fr = FlightRoute(user_id, points)
    insert(fr)
    fr
  }

  def findOneByID(id: String): Option[FlightRoute] = findOneByID(new ObjectId(id))
}