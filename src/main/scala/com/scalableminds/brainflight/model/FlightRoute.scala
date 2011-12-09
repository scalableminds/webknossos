package com.scalableminds.brainflight.model


import com.foursquare.rogue.Rogue._

import com.mongodb.{BasicDBObjectBuilder, DBObject}
import java.util.regex.Pattern
import net.liftweb.mongodb.record._
import net.liftweb.mongodb.record.field._
import net.liftweb.record.field._
import net.liftweb.record._
import org.bson.types._
import net.liftweb.mongodb.{JsonObject, JsonObjectMeta}
import net.liftweb.http.SessionVar
import net.liftweb.common.{Full, Box}
import java.util.Date

/**
 * User: tmbo
 * Date: 05.11.11
 * Time: 11:59
 */

/**
 * Flight route which is currently active and not yet saved to DB
 */
object SessionRoute extends SessionVar[FlightRoute](FlightRoute.createRecord) {
  def saveRoute(box: Box[User]) {
    box match {
      case Full(user) if SessionRoute.is.points.is.size > 1 =>
        val l = user.flightRoutes.is
        user.flightRoutes(SessionRoute.id.is :: l).save
        SessionRoute.timestamp(new Date())
        SessionRoute.userID(user.id.is).save
      case _ =>
    }
  }
}

/**
 * One point on a flight route
 */
case class RoutePoint(x: Int, y: Int, z: Int) extends JsonObject[RoutePoint] {
  def meta = RoutePoint
}

object RoutePoint extends JsonObjectMeta[RoutePoint]

/**
 * Complete flight route
 */
class FlightRoute private() extends MongoRecord[FlightRoute] with ObjectIdPk[FlightRoute] {
  def meta = FlightRoute

  object points extends MongoJsonObjectListField(this, RoutePoint)

  object userID extends ObjectIdRefField(this, User)
  object timestamp extends DateTimeField(this)
}

object FlightRoute extends FlightRoute with MongoMetaRecord[FlightRoute]