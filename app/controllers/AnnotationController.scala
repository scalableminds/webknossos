package controllers

import javax.inject.Inject

import akka.util.Timeout
import com.scalableminds.util.mvc.JsonResult
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import models.annotation.{Annotation, _}
import models.binary.DataSetDAO
import models.task.TaskDAO
import models.user.time._
import models.user.{UsedAnnotationDAO, User, UserDAO}
import net.liftweb.common.{Full, _}
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsArray, JsObject, _}
import play.twirl.api.Html
import reactivemongo.bson.BSONObjectID

import scala.concurrent.duration._
import scala.util.Try

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
class AnnotationController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with Secured
    with TracingInformationProvider {

  implicit val timeout = Timeout(5 seconds)

  def info(typ: String, id: String, readOnly: Boolean = false) = UserAwareAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)

    withAnnotation(annotationId) { annotation =>
        for {
          js <- tracingInformation(annotation, readOnly)
        } yield {
          request.userOpt.foreach { user =>
            UsedAnnotationDAO.use(user, annotationId)
            TimeSpanService.logUserInteraction(user, Some(annotation))            // log time when a user starts working
          }
          Ok(js)
        }
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, readOnly = true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String, readOnly: Boolean) = Authenticated.async { implicit request =>
    withMergedAnnotation(typ, id, mergedId, mergedTyp, readOnly) { annotation =>
      for {
        _ <- annotation.restrictions.allowAccess(request.user) ?~> Messages("notAllowed") ~> BAD_REQUEST
        savedAnnotation <- annotation.copy(typ = AnnotationType.Explorational, _id = BSONObjectID.generate).saveToDB
        json <- savedAnnotation.toJson(Some(request.user))
      } yield {
        JsonOk(json, Messages("annotation.merge.success"))
      }
    }
  }

  def empty(typ: String, id: String) = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }

  def loggedTime(typ: String, id: String) = Authenticated.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    withAnnotation(annotationId) { annotation =>
      for {
        _ <- annotation.restrictions.allowAccess(request.user) ?~> Messages("notAllowed") ~> BAD_REQUEST
        loggedTimeAsMap <- TimeSpanService.loggedTimeOfAnnotation(id, TimeSpan.groupByMonth)
      } yield {
        Ok(Json.arr(
          loggedTimeAsMap.map {
            case (month, duration) =>
              Json.obj("interval" -> month, "durationInSeconds" -> duration.toSeconds)
          }
        ))
      }
    }
  }

  def revert(typ: String, id: String, version: Int) = Authenticated.async { implicit request =>
    //TODO: rocksDB
    Fox.successful(JsonOk)

//    for {
//      oldAnnotation <- findAnnotation(typ, id)
//      _ <- isUpdateAllowed(oldAnnotation, version).toFox
//      _ <- oldAnnotation.isRevertPossible ?~> Messages("annotation.revert.toOld")
//      updates <- AnnotationUpdateService.retrieveAll(typ, id, maxVersion=version) ?~> Messages("annotation.revert.findUpdatesFailed")
//      combinedUpdate = JsArray(combineUpdates(updates))
//      resetAnnotation <- oldAnnotation.muta.resetToBase() ?~> Messages("annotation.revert.resetToBaseFailed")
//      updateableAnnotation <- isUpdateable(resetAnnotation) ?~> Messages("annotation.update.impossible")
//      result <- handleUpdates(updateableAnnotation, combinedUpdate, version, System.currentTimeMillis) ?~> Messages("annotation.revert.handlingUpdatesFailed")
//      _ <- AnnotationUpdateService.removeAll(typ, id, aboveVersion = version) ?~> Messages("annotation.revert.deleteUpdatesFailed")
//    } yield {
//      logger.info(s"REVERTED using update [$typ - $id, $version]: $combinedUpdate")
//      JsonOk(result, "annotation.reverted")
//    }
  }

  def reset(typ: String, id: String) = Authenticated.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.user, annotation.team)
        reset <- annotation.muta.resetToBase() ?~> Messages("annotation.reset.failed")
        json <- reset.toJson(Some(request.user))
      } yield {
        JsonOk(json, Messages("annotation.reset.success"))
      }
    }
  }

  def reopen(typ: String, id: String) = Authenticated.async { implicit request =>
    // Reopening an annotation is allowed if either the user owns the annotation or the user is allowed to administrate
    // the team the annotation belongs to
    def isReopenAllowed(user: User, annotation: Annotation) = {
       annotation._user.contains(user._id) || user.adminTeams.exists(_.team == annotation.team)
    }

    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- isReopenAllowed(request.user, annotation) ?~> "reopen.notAllowed"
        reopenedAnnotation <- annotation.muta.reopen() ?~> "annotation.invalid"
        json <- reopenedAnnotation.toJson(Some(request.user))
      } yield {
        JsonOk(json, Messages("annotation.reopened"))
      }
    }
  }

  def createExplorational = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      dataSetName <- postParameter("dataSetName") ?~> Messages("dataSet.notSupplied")
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      contentType <- postParameter("contentType") ?~> Messages("annotation.contentType.notSupplied")
      annotation <- AnnotationService.createExplorationalFor(request.user, dataSet, contentType) ?~> Messages("annotation.create.failed")
    } yield {
      Redirect(routes.AnnotationController.empty(annotation.typ, annotation.id))
    }
  }

  def isUpdateable(Annotation: Annotation) = {
    Annotation match {
      case a: Annotation => Some(a)
      case _             => None
    }
  }

  def isUpdateAllowed(annotation: Annotation, version: Int)(implicit request: AuthenticatedRequest[_]) = {
    //TODO: rocksDB
    Full(true)
//    if (annotation.restrictions.allowUpdate(request.user))
//      Full(version == annotation.version + 1)
//    else
//      Failure(Messages("notAllowed")) ~> FORBIDDEN
  }

  def updateWithJson(typ: String, id: String, version: Int) = Authenticated.async(parse.json(maxLength = 8388608)) { implicit request =>
    // Logger.info(s"Tracing update [$typ - $id, $version]: ${request.body}")
//    AnnotationUpdateService.store(typ, id, version, request.body)
//    val clientTimestamp = request.headers.get("x-date").flatMap(s => Try(s.toLong).toOption).getOrElse(System.currentTimeMillis)
//
//    for {
//      oldAnnotation <- findAnnotation(typ, id)
//      updateableAnnotation <- isUpdateable(oldAnnotation) ?~> Messages("annotation.update.impossible")
//      isAllowed <- isUpdateAllowed(oldAnnotation, version).toFox
//      result <- executeUpdateIfAllowed(updateableAnnotation, isAllowed, request.body, version, request.user, clientTimestamp)
//    } yield {
//      result
//    }
    Fox.successful(JsonOk)
  }

  def finishAnnotation(typ: String, id: String, user: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      (updated, message) <- annotation.muta.finishAnnotation(user)
    } yield {
      TimeSpanService.logUserInteraction(user, Some(annotation))         // log time on a tracings end
      (updated, message)
    }
  }

  def finish(typ: String, id: String) = Authenticated.async { implicit request =>
    for {
      (updated, message) <- finishAnnotation(typ, id, request.user)(GlobalAccessContext)
      json <- updated.toJson(Some(request.user))
    } yield {
      JsonOk(json, Messages(message))
    }
  }

  def finishAll(typ: String) = Authenticated.async(parse.json) { implicit request =>
    withJsonAs[JsArray](request.body \ "annotations") { annotationIds =>
      val results = Fox.serialSequence(annotationIds.value.toList){jsValue =>
        jsValue.asOpt[String].toFox.flatMap(id => finishAnnotation(typ, id, request.user)(GlobalAccessContext))
      }

      results.map { results =>
        JsonOk(Messages("annotation.allFinished"))
      }
    }
  }

  def finishWithRedirect(typ: String, id: String) = Authenticated.async { implicit request =>
    val redirectTarget = if(!request.user.isAnonymous) "/dashboard" else "/thankyou"

    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      finished <- annotation.muta.finishAnnotation(request.user).futureBox
    } yield {
      finished match {
        case Full((_, message)) =>
          Redirect(redirectTarget).flashing("success" -> Messages(message))
        case Failure(message, _, _) =>
          Redirect(redirectTarget).flashing("error" -> Messages(message))
        case _ =>
          Redirect(redirectTarget).flashing("error" -> Messages("error.unknown"))
      }
    }
  }

  def nameExplorativeAnnotation(typ: String, id: String) = Authenticated.async(parse.urlFormEncoded) { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      name <- postParameter("name") ?~> Messages("annotation.invalidName")
      _ <- annotation.muta.rename(name)
    } yield {
      JsonOk(
        Json.obj(),
        Messages("annotation.setName"))
    }
  }

  def annotationsForTask(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team)
      annotations <- task.annotations
      jsons <- Fox.serialSequence(annotations)(_.toJson(Some(request.user)))
    } yield {
      Ok(JsArray(jsons.flatten))
    }
  }

  def cancel(typ: String, id: String) = Authenticated.async { implicit request =>
    def tryToCancel(annotation: Annotation) = {
      annotation match {
        case t if t.typ == AnnotationType.Task =>
          annotation.muta.cancelTask().map { _ =>
            JsonOk(Messages("task.finished"))
          }
        case _                                 =>
          Fox.successful(JsonOk(Messages("annotation.finished")))
      }
    }

    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.user, annotation.team)
        result <- tryToCancel(annotation)
      } yield {
        UsedAnnotationDAO.removeAll(AnnotationIdentifier(typ, id))
        result
      }
    }
  }

  def transfer(typ: String, id: String) = Authenticated.async(parse.json) { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      userId <- (request.body \ "userId").asOpt[String].toFox
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      result <- annotation.muta.transferToUser(user)
    } yield {
      JsonOk(Messages("annotation.transfered"))
    }
  }

  def duplicate(typ: String, id: String) = Authenticated.async { implicit request =>
    //TODO: RocksDB
    Fox.successful(JsonOk)
//
//    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
//      for {
//        content <- annotation.contentReference
//        temp <- content.temporaryDuplicate(BSONObjectID.generate().stringify)
//        clonedContent <- temp.saveToDB
//        dataSet <- DataSetDAO.findOneBySourceName(
//          content.dataSetName) ?~> Messages("dataSet.notFound", content.dataSetName)
//        clonedAnnotation <- AnnotationService.createFrom(
//          request.user, clonedContent, AnnotationType.Explorational, None) ?~> Messages("annotation.create.failed")
//      } yield {
//        Redirect(routes.AnnotationController.trace(clonedAnnotation.typ, clonedAnnotation.id))
//      }
//    }
  }
}
