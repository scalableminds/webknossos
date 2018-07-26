package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.Fox
import models.annotation.AnnotationSQLDAO
import models.binary.DataSetSQLDAO
import models.task.TaskSQLDAO
import models.user.time.{TimeSpanSQL, TimeSpanService}
import models.user.UserSQLDAO
import oxalis.security.WebknossosSilhouette.SecuredAction
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json._
import play.api.libs.json._

import scala.concurrent.duration.Duration

class StatisticsController @Inject()(val messagesApi: MessagesApi)
  extends Controller {

  val intervalHandler = Map(
    "month" -> TimeSpanSQL.groupByMonth _,
    "week" -> TimeSpanSQL.groupByWeek _
  )

  def intervalTracingTimeJson[T <: models.user.time.Interval](times: Map[T, Duration]) = times.map {
    case (interval, duration) => Json.obj(
      "start" -> interval.start.toString,
      "end" -> interval.end.toString,
      "tracingTime" -> duration.toMillis
    )
  }

  def webKnossos(interval: String, start: Option[Long], end: Option[Long]) = SecuredAction.async { implicit request =>
    intervalHandler.get(interval) match {
      case Some(handler) =>
        for {
          times <- TimeSpanService.loggedTimePerInterval(handler, start, end)
          numberOfUsers <- UserSQLDAO.countAll
          numberOfDatasets <- DataSetSQLDAO.countAll
          numberOfAnnotations <- AnnotationSQLDAO.countAll
          numberOfAssignments <- TaskSQLDAO.countAllOpenInstances
        } yield {
          Ok(Json.obj(
            "name" -> "oxalis",
            "tracingTimes" -> intervalTracingTimeJson(times),
            "numberOfUsers" -> numberOfUsers,
            "numberOfDatasets" -> numberOfDatasets,
            "numberOfAnnotations" -> numberOfAnnotations,
            "numberOfOpenAssignments" -> numberOfAssignments
          ))
        }
      case _             =>
        Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
    }
  }


  def users(interval: String, start: Option[Long], end: Option[Long], limit: Int) = SecuredAction.async { implicit request =>
    for {
      handler <- intervalHandler.get(interval) ?~> Messages("statistics.interval.invalid")
      users <- UserSQLDAO.findAll
      usersWithTimes <- Fox.serialCombined(users)(user => TimeSpanService.loggedTimeOfUser(user, handler, start, end).map(user -> _))
      data = usersWithTimes.sortBy(-_._2.map(_._2.toMillis).sum).take(limit)
      json <- Fox.combined(data.map {
        case (user, times) => for {
          userJs <- user.compactWrites
        } yield {Json.obj(
          "user" -> userJs,
          "tracingTimes" -> intervalTracingTimeJson(times)
        )}
        case _ => Fox.failure("serialization.failed")
      })
    } yield {
      Ok(Json.toJson(json))
    }
  }
}
