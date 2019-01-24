package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.Fox
import models.annotation.AnnotationDAO
import models.binary.DataSetDAO
import models.task.TaskDAO
import models.user.time.{TimeSpan, TimeSpanService}
import models.user.{UserDAO, UserService}
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import play.api.i18n.{Messages}
import play.api.libs.json.Json._
import play.api.libs.json._

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.Duration

class StatisticsController @Inject()(timeSpanService: TimeSpanService,
                                     userDAO: UserDAO,
                                     userService: UserService,
                                     dataSetDAO: DataSetDAO,
                                     taskDAO: TaskDAO,
                                     annotationDAO: AnnotationDAO,
                                     sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  val intervalHandler = Map(
    "month" -> TimeSpan.groupByMonth _,
    "week" -> TimeSpan.groupByWeek _
  )

  def intervalTracingTimeJson[T <: models.user.time.Interval](times: Map[T, Duration]) = times.map {
    case (interval, duration) =>
      Json.obj(
        "start" -> interval.start.toString,
        "end" -> interval.end.toString,
        "tracingTime" -> duration.toMillis
      )
  }

  def webKnossos(interval: String, start: Option[Long], end: Option[Long]) = sil.SecuredAction.async {
    implicit request =>
      intervalHandler.get(interval) match {
        case Some(handler) =>
          for {
            organizationId <- Fox.successful(request.identity._organization)
            times <- timeSpanService.loggedTimePerInterval(handler, start, end, organizationId)
            numberOfUsers <- userDAO.countAllForOrganization(organizationId)
            numberOfDatasets <- dataSetDAO.countAllForOrganization(organizationId)
            numberOfAnnotations <- annotationDAO.countAllForOrganization(organizationId)
            numberOfAssignments <- taskDAO.countAllOpenInstancesForOrganization(organizationId)
          } yield {
            Ok(
              Json.obj(
                "name" -> "oxalis",
                "tracingTimes" -> intervalTracingTimeJson(times),
                "numberOfUsers" -> numberOfUsers,
                "numberOfDatasets" -> numberOfDatasets,
                "numberOfAnnotations" -> numberOfAnnotations,
                "numberOfOpenAssignments" -> numberOfAssignments
              ))
          }
        case _ =>
          Fox.successful(BadRequest(Messages("statistics.interval.invalid")))
      }
  }

  def users(interval: String, start: Option[Long], end: Option[Long], limit: Int) = sil.SecuredAction.async {
    implicit request =>
      for {
        handler <- intervalHandler.get(interval) ?~> "statistics.interval.invalid"
        users <- userDAO.findAll
        usersWithTimes <- Fox.serialCombined(users)(user =>
          timeSpanService.loggedTimeOfUser(user, handler, start, end).map(user -> _))
        data = usersWithTimes.sortBy(-_._2.map(_._2.toMillis).sum).take(limit)
        json <- Fox.combined(data.map {
          case (user, times) =>
            for {
              userJs <- userService.compactWrites(user)
            } yield {
              Json.obj(
                "user" -> userJs,
                "tracingTimes" -> intervalTracingTimeJson(times)
              )
            }
          case _ => Fox.failure("serialization.failed")
        })
      } yield {
        Ok(Json.toJson(json))
      }
  }
}
