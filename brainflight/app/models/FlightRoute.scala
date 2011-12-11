package models

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
import play.api.Play
import play.api.Play.current

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 11.12.11
 * Time: 22:07
 */
case class RoutePoint(x: Int , y: Int , z:Int)

case class FlightRoute(points: List[RoutePoint] ,user_id: ObjectId,_id: ObjectId)

object FlightRoute extends BasicDAO[FlightRoute]("flightroutes"){

}