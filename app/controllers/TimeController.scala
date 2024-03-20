package controllers

import play.silhouette.api.Silhouette
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationType
import models.annotation.AnnotationType.AnnotationType

import scala.collection.immutable.ListMap
import javax.inject.Inject
import models.user._
import models.user.time.{Month, TimeSpan, TimeSpanDAO, TimeSpanService}
import net.liftweb.common.Box
import play.api.libs.json.Json
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

  def timeSpansOfUser(userId: String,
                      startDate: Long,
                      endDate: Long,
                      annotationTypes: String,
                      projectIds: Option[String]): Action[AnyContent] =
    sil.SecuredAction.async { implicit request =>
      for {
        userIdValidated <- ObjectId.fromString(userId)
        projectIdsValidated <- parseObjectIds(projectIds)
        annotationTypesValidated <- parseAnnotationTypes(annotationTypes) ?~> "invalidAnnotationType"
        user <- userService.findOneCached(userIdValidated) ?~> "user.notFound" ~> NOT_FOUND
        isTeamManagerOrAdmin <- userService.isTeamManagerOrAdminOf(request.identity, user)
        _ <- bool2Fox(isTeamManagerOrAdmin || user._id == request.identity._id) ?~> "user.notAuthorised" ~> FORBIDDEN
        userJs <- userService.compactWrites(user)
        timeSpansJs <- timeSpanDAO.findAllByUserWithTask(user._id,
                                                         Instant(startDate),
                                                         Instant(endDate),
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
        teamIdsValidated <- parseObjectIds(teamIds) ?~> "invalidTeamId"
        annotationTypesValidated <- parseAnnotationTypes(annotationTypes) ?~> "invalidAnnotationType"
        _ <- bool2Fox(annotationTypesValidated.nonEmpty) ?~> "annotationTypesEmpty"
        _ <- bool2Fox(annotationTypesValidated.forall(typ =>
          typ == AnnotationType.Explorational || typ == AnnotationType.Task)) ?~> "unsupportedAnnotationType"
        projectIdsValidated <- parseObjectIds(projectIds)
        usersByTeams <- if (teamIdsValidated.isEmpty) userDAO.findAll else userDAO.findAllByTeams(teamIdsValidated)
        admins <- userDAO.findAdminsByOrg(request.identity._organization)
        usersFiltered = (usersByTeams ++ admins).distinct
        usersWithTimesJs <- timeSpanDAO.timeSummedSearch(Instant(start),
                                                         Instant(end),
                                                         usersFiltered.map(_._id),
                                                         annotationTypesValidated,
                                                         projectIdsValidated)
      } yield Ok(Json.toJson(usersWithTimesJs))
    }

  private def parseCommaSeparated[T](commaSeparatedStrOpt: Option[String])(parseEntry: String => Fox[T]): Fox[List[T]] =
    commaSeparatedStrOpt match {
      case None                                                 => Fox.successful(List.empty)
      case Some(commaSeparatedStr) if commaSeparatedStr.isEmpty => Fox.successful(List.empty)
      case Some(commaSeparatedStr) =>
        Fox.serialCombined(commaSeparatedStr.split(",").toList)(entry => parseEntry(entry))
    }

  private def parseObjectIds(idsStrOpt: Option[String]): Fox[List[ObjectId]] =
    parseCommaSeparated(idsStrOpt)(ObjectId.fromString)

  private def parseAnnotationTypes(typesStr: String): Fox[List[AnnotationType]] =
    parseCommaSeparated(Some(typesStr)) { typ: String =>
      AnnotationType.fromString(typ)
    }

}
