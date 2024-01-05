package controllers

import javax.inject.Inject
import com.scalableminds.util.tools.Fox
import models.annotation.AnnotationDAO
import models.dataset.DatasetDAO
import models.task.TaskDAO
import models.user.time.{TimeSpan, TimeSpanService}
import models.user.{UserDAO, UserService}
import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import play.api.i18n.Messages
import play.api.libs.json.Json._
import play.api.libs.json._
import play.api.mvc.{Action, AnyContent}
import security.WkEnv

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.Duration

class StatisticsController @Inject()(timeSpanService: TimeSpanService,
                                     userDAO: UserDAO,
                                     userService: UserService,
                                     datasetDAO: DatasetDAO,
                                     taskDAO: TaskDAO,
                                     annotationDAO: AnnotationDAO,
                                     sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller {

  private val intervalHandler = Map(
    "month" -> TimeSpan.groupByMonth _,
    "week" -> TimeSpan.groupByWeek _
  )

  private def intervalTracingTimeJson[T <: models.user.time.Interval](times: Map[T, Duration]) = times.map {
    case (interval, duration) =>
      Json.obj(
        "start" -> interval.start.toString,
        "end" -> interval.end.toString,
        "tracingTime" -> duration.toMillis
      )
  }

  def webknossos(interval: String, start: Option[Long], end: Option[Long]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      intervalHandler.get(interval) match {
        case Some(handler) =>
          for {
            organizationId <- Fox.successful(request.identity._organization)
            _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, organizationId)) ?~> "notAllowed" ~> FORBIDDEN
            times <- timeSpanService.loggedTimePerInterval(handler,
                                                           start.map(Instant(_)),
                                                           end.map(Instant(_)),
                                                           organizationId)
            numberOfUsers <- userDAO.countAllForOrganization(organizationId)
            numberOfDatasets <- datasetDAO.countAllForOrganization(organizationId)
            numberOfAnnotations <- annotationDAO.countAllForOrganization(organizationId)
            numberOfAssignments <- taskDAO.countAllPendingInstancesForOrganization(organizationId)
          } yield {
            Ok(
              Json.obj(
                "name" -> "webknossos",
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

  def users(interval: String, start: Option[Long], end: Option[Long], limit: Int): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)) ?~> "notAllowed" ~> FORBIDDEN
        handler <- intervalHandler.get(interval) ?~> "statistics.interval.invalid"
        users <- userDAO.findAll //Access query ensures only users of own orga are shown
        notUnlistedUsers = users.filter(!_.isUnlisted)
        usersWithTimes <- Fox.serialCombined(notUnlistedUsers)(user =>
          timeSpanService.loggedTimeOfUser(user, handler, start.map(Instant(_)), end.map(Instant(_))).map(user -> _))
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
      } yield Ok(Json.toJson(json))
    }
}
