/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package controllers

import oxalis.security.Secured
import models.user.time.{TimeSpan, TimeSpanService}
import play.api.i18n.Messages
import play.api.libs.json.Json
import braingames.util.Fox
import play.api.libs.concurrent.Execution.Implicits._

object StatisticsController extends Controller with Secured{
  val intervalHandler = Map(
    "month" -> TimeSpan.groupByMonth _,
    "week" -> TimeSpan.groupByWeek _
  )

  def oxalis(interval: String, start: Option[Long], end: Option[Long]) = Authenticated.async{ implicit request =>
    intervalHandler.get(interval) match{
      case Some(handler) =>
        TimeSpanService.loggedTimePerInterval(handler, start, end).map{ times =>
          val json = times.map{
            case (interval, duration) => Json.obj(
              "start" -> interval.start.toString(),
              "end" -> interval.end.toString(),
              "tracing-time" -> duration.toMillis
            )
          }
          Ok(Json.obj(
            "tracing-times" -> json
          ))
        }
      case _ =>
        Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
    }
  }
}
