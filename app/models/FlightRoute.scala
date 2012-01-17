package models

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Mode
import play.api.Configuration
import play.api.Play.current
import brainflight.tools.geometry.Vector3D
import java.util.Date

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 22:07
 */
case class FlightRoute(user_id: ObjectId, points: List[Vector3D] = Nil, closed: Boolean = false, timestamp: Date = new Date, _id: ObjectId = new ObjectId)

object FlightRoute extends BasicDAO[FlightRoute]("routes") {
  def createForUser(user_id: ObjectId, points: List[Vector3D] = Nil) = {
    closeOpenRoutes(user_id)
    val fr = FlightRoute(user_id, points)
    insert(fr)
    fr
  }
  def closeOpenRoutes(user_id: ObjectId){
    // TODO: REMOVE THIS later (after ext session is implemented)
    if(Play.maybeApplication.map(_.mode).getOrElse(Mode.Dev) == Mode.Prod)
    	update(MongoDBObject("user_id" -> user_id, "closed" -> false), $set ("closed" -> true), false, true)
  }
  
  def findOpenByID(id: String): Option[FlightRoute] = {
    findOneByID(new ObjectId(id)) match {
      case Some(r) if !r.closed => Some(r)
      case _ => None
    }
  }
}