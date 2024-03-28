package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType

import scala.collection.immutable.ListMap
import javax.inject.Inject
import models.user._
import models.user.time.{Month, TimeSpan, TimeSpanDAO, TimeSpanService}
import net.liftweb.common.Box
import play.api.libs.json.{JsObject, Json}
import play.api.mvc.{Action, AnyContent}
import security.WkEnv
import utils.ObjectId

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.Duration

class TimeController @Inject()(userService: UserService,
                               userDAO: UserDAO,
                               timeSpanDAO: TimeSpanDAO,
                               timeSpanService: TimeSpanService,
                               sil: Silhouette[WkEnv])(implicit ec: ExecutionContext)
    extends Controller
    with FoxImplicits {

  // Called by webknossos-libs client. Sums monthly. Includes exploratives
  def userLoggedTime(userId: String): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId) ?~> "user.id.invalid"
        user <- userDAO.findOne(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        _ <- Fox.assertTrue(userService.isEditableBy(user, request.identity)) ?~> "notAllowed" ~> FORBIDDEN
        timeSpansBox: Box[List[TimeSpan]] <- timeSpanDAO.findAllByUser(user._id).futureBox
        timesGrouped: Map[Month, Duration] = timeSpanService.sumTimespansPerInterval(TimeSpan.groupByMonth,
                                                                                     timeSpansBox)
        timesGroupedSorted = ListMap(timesGrouped.toSeq.sortBy(_._1): _*)
      } yield {
        JsonOk(
          Json.obj("loggedTime" ->
            timesGroupedSorted.map {
              case (paymentInterval, duration) =>
                Json.obj("paymentInterval" -> paymentInterval, "durationInSeconds" -> duration.toSeconds)
            }))
      }
    }

  def timeSummedByAnnotationForUser(userId: String,
                                    start: Long,
                                    end: Long,
                                    annotationTypes: String,
                                    projectIds: Option[String]): Action[AnyContent] = sil.SecuredAction.async {
    implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        projectIdsValidated <- ObjectId.fromCommaSeparated(projectIds)
        annotationTypesValidated <- AnnotationType.fromCommaSeparated(annotationTypes) ?~> "invalidAnnotationType"
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        userJs <- userService.compactWrites(user)
        timesByAnnotation <- timeSpanDAO.summedByAnnotationForUser(user._id,
                                                                   Instant(start),
                                                                   Instant(end),
                                                                   annotationTypesValidated,
                                                                   projectIdsValidated)
      } yield Ok(Json.obj("user" -> userJs, "timesByAnnotation" -> timesByAnnotation))
  }

  def timeSpansOfUser(userId: String,
                      start: Long,
                      end: Long,
                      annotationTypes: String,
                      projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        projectIdsValidated <- ObjectId.fromCommaSeparated(projectIds)
        annotationTypesValidated <- AnnotationType.fromCommaSeparated(annotationTypes) ?~> "invalidAnnotationType"
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        userJs <- userService.compactWrites(user)
        timeSpansJs <- timeSpanDAO.findAllByUserWithTask(user._id,
                                                         Instant(start),
                                                         Instant(end),
                                                         annotationTypesValidated,
                                                         projectIdsValidated)
      } yield Ok(Json.obj("user" -> userJs, "timelogs" -> timeSpansJs))
    }

  def timeOverview(start: Long,
                   end: Long,
                   annotationTypes: String,
                   teamIds: Option[String],
                   projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOfOrg(request.identity, request.identity._organization)) ?~> "notAllowed" ~> FORBIDDEN
        teamIdsValidated <- ObjectId.fromCommaSeparated(teamIds) ?~> "invalidTeamId"
        annotationTypesValidated <- AnnotationType.fromCommaSeparated(annotationTypes) ?~> "invalidAnnotationType"
        _ <- bool2Fox(annotationTypesValidated.nonEmpty) ?~> "annotationTypesEmpty"
        _ <- bool2Fox(annotationTypesValidated.forall(typ =>
          typ == AnnotationType.Explorational || typ == AnnotationType.Task)) ?~> "unsupportedAnnotationType"
        projectIdsValidated <- ObjectId.fromCommaSeparated(projectIds)
        usersByTeams <- if (teamIdsValidated.isEmpty) userDAO.findAll else userDAO.findAllByTeams(teamIdsValidated)
        admins <- userDAO.findAdminsByOrg(request.identity._organization)
        usersFiltered = (usersByTeams ++ admins).distinct
        usersWithTimesJs <- timeSpanDAO.timeOverview(Instant(start),
                                                     Instant(end),
                                                     usersFiltered.map(_._id),
                                                     annotationTypesValidated,
                                                     projectIdsValidated)
      } yield Ok(Json.toJson(usersWithTimesJs))
    }

}
