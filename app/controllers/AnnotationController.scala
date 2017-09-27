package controllers

import javax.inject.Inject

import scala.concurrent.duration._
import akka.util.Timeout
import com.scalableminds.util.mvc.JsonResult
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import models.annotation.{Annotation, _}
import models.binary.DataSetDAO
import models.task.TaskDAO
import models.user.time._
import models.user.{UsedAnnotationDAO, User, UserDAO}
import net.liftweb.common.{Full, _}
import oxalis.security.silhouetteOxalis.{UserAwareAction, UserAwareRequest, SecuredRequest, SecuredAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsArray, JsObject, _}
import play.api.mvc.Action
import play.twirl.api.Html
import reactivemongo.bson.BSONObjectID

import scala.util.Try

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
class AnnotationController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with TracingInformationProvider {

  implicit val timeout = Timeout(5 seconds)

  def annotationJson(user: User, annotation: AnnotationLike, exclude: List[String])(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), exclude)

  def info(typ: String, id: String, readOnly: Boolean = false) = UserAwareAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    withAnnotation(annotationId) { annotation =>
        for {
          js <- tracingInformation(annotation, readOnly)
        } yield {
          request.identity.foreach { user =>
            UsedAnnotationDAO.use(user, annotationId)
            TimeSpanService.logUserInteraction(user, Some(annotation))            // log time when a user starts working
          }
          Ok(js)
        }
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, readOnly = true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String, readOnly: Boolean) = SecuredAction.async { implicit request =>
    withMergedAnnotation(typ, id, mergedId, mergedTyp, readOnly) { annotation =>
      for {
        _ <- annotation.restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
        temporary <- annotation.temporaryDuplicate(keepId = true)
        explorational = temporary.copy(typ = AnnotationType.Explorational)
        savedAnnotation <- explorational.saveToDB
        json <- annotationJson(request.identity, savedAnnotation, exclude = Nil)
      } yield {
        //Redirect(routes.AnnotationController.trace(savedAnnotation.typ, savedAnnotation.id))
        JsonOk(json, Messages("annotation.merge.success"))
      }
    }
  }

  def trace(typ: String, id: String) = SecuredAction { implicit request =>
    Ok(empty)
  }

  def traceReadOnly(typ: String, id: String) = UserAwareAction { implicit request =>
    Ok(empty)
  }

  def loggedTime(typ: String, id: String) = SecuredAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    withAnnotation(annotationId) { annotation =>
      for {
        _ <- annotation.restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
        loggedTimeAsMap <- TimeSpanService.loggedTimeOfAnnotation(id, TimeSpan.groupByMonth)
      } yield {
        Ok(Json.arr(
          loggedTimeAsMap.map {
            case (month, duration) =>
              Json.obj("interval" -> month, "durationInSeconds" -> duration.toSeconds)
          }
        ))
      }
    }(securedRequestToUserAwareRequest)
  }

  // DISABLED: Due to changes in the json update protocol we are currently unable to parse all previous
  // json updates and hence we can not use them to replay previous updates. It is also infeasible to write
  // an evolution for this since it is to expensive to calculate the missing information to create the proper updates

   def combineUpdates(updates: List[AnnotationUpdate]) = updates.foldLeft(Seq.empty[JsValue]){
     case (updates, AnnotationUpdate(_, _, _, JsArray(nextUpdates), _, _)) =>
       updates ++ nextUpdates
     case (updates, u) =>
       logger.warn("dropping update during replay! Update: " + u)
       updates
   }

  // def listUpdates(typ: String, id: String)= Authenticated.async { implicit request =>
  //   withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
  //     for {
  //       updates <- AnnotationUpdateService.retrieveAll(typ, id, limit = Some(100))
  //       combinedUpdate = JsArray(combineUpdates(updates))
  //     } yield Ok(combinedUpdate)
  //   }
  // }

  // def transferUpdates(typ: String, id: String, fromId: String, fromTyp: String, maxVersion: Int) = Authenticated.async { implicit request =>
  //   def applyUpdates(updates: List[AnnotationUpdate], targetAnnotation: AnnotationLike): Fox[AnnotationLike] = {
  //     updates.splitAt(100) match {
  //       case (Nil, _) =>
  //         Fox.successful(targetAnnotation)
  //       case (first, last) =>
  //         val combinedUpdate = combineUpdates(first)
  //         targetAnnotation.muta.updateFromJson(combinedUpdate).flatMap{ updated =>
  //           applyUpdates(last, updated)
  //         }
  //     }
  //   }

  //   for {
  //     targetAnnotation <- findAnnotation(typ, id)
  //     _ <- isUpdateAllowed(targetAnnotation, targetAnnotation.version + 1).toFox
  //     _ <- findAnnotation(fromTyp, fromId)
  //     updates <- AnnotationUpdateService.retrieveAll(fromTyp, fromId, maxVersion).toFox
  //     result <- applyUpdates(updates, targetAnnotation)
  //   } yield JsonOk(Messages("annotation.updates.transfered"))
  // }

  def revert(typ: String, id: String, version: Int) = SecuredAction.async { implicit request =>
    for {
      oldAnnotation <- findAnnotation(typ, id)(securedRequestToUserAwareRequest)
      _ <- isUpdateAllowed(oldAnnotation, version).toFox
      _ <- oldAnnotation.isRevertPossible ?~> Messages("annotation.revert.toOld")
      updates <- AnnotationUpdateService.retrieveAll(typ, id, maxVersion=version) ?~> Messages("annotation.revert.findUpdatesFailed")
      combinedUpdate = JsArray(combineUpdates(updates))
      resetAnnotation <- oldAnnotation.muta.resetToBase() ?~> Messages("annotation.revert.resetToBaseFailed")
      updateableAnnotation <- isUpdateable(resetAnnotation) ?~> Messages("annotation.update.impossible")
      result <- handleUpdates(updateableAnnotation, combinedUpdate, version, System.currentTimeMillis) ?~> Messages("annotation.revert.handlingUpdatesFailed")
      _ <- AnnotationUpdateService.removeAll(typ, id, aboveVersion = version) ?~> Messages("annotation.revert.deleteUpdatesFailed")
    } yield {
      logger.info(s"REVERTED using update [$typ - $id, $version]: $combinedUpdate")
      JsonOk(result, "annotation.reverted")
    }
  }

  def reset(typ: String, id: String) = SecuredAction.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.identity, annotation.team)
        reset <- annotation.muta.resetToBase() ?~> Messages("annotation.reset.failed")
        json <- annotationJson(request.identity, reset,  List("content"))
      } yield {
        JsonOk(json, Messages("annotation.reset.success"))
      }
    }(securedRequestToUserAwareRequest)
  }

  def reopen(typ: String, id: String) = SecuredAction.async { implicit request =>
    // Reopening an annotation is allowed if either the user owns the annotation or the user is allowed to administrate
    // the team the annotation belongs to
    def isReopenAllowed(user: User, annotation: AnnotationLike) = {
       annotation._user.contains(user._id) || user.adminTeams.exists(_.team == annotation.team)
    }

    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- isReopenAllowed(request.identity, annotation) ?~> "reopen.notAllowed"
        reopenedAnnotation <- annotation.muta.reopen() ?~> "annotation.invalid"
        json <- annotationJson(request.identity, reopenedAnnotation,  List("content"))
      } yield {
        JsonOk(json, Messages("annotation.reopened"))
      }
    }(securedRequestToUserAwareRequest)
  }

  def createExplorational = SecuredAction.async(parse.urlFormEncoded) { implicit request =>
    for {
      dataSetName <- postParameter("dataSetName") ?~> Messages("dataSet.notSupplied")
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      contentType <- postParameter("contentType") ?~> Messages("annotation.contentType.notSupplied")
      annotation <- AnnotationService.createExplorationalFor(request.identity, dataSet, contentType) ?~> Messages("annotation.create.failed")
    } yield {
      Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
    }
  }

  def handleUpdates(annotation: Annotation, js: JsValue, version: Int, clientTimestamp: Long)(implicit request: SecuredRequest[_]): Fox[JsObject] = {
    js match {
      case JsArray(jsUpdates) if jsUpdates.length >= 1 =>
        for {
          updated <- annotation.muta.updateFromJson(jsUpdates) //?~> Messages("format.json.invalid")
        } yield {
          val timestamps = jsUpdates.map(update => (update \ "timestamp").as[Long]).sorted
          TimeSpanService.logUserInteraction(timestamps, request.identity, Some(updated))
          Json.obj("version" -> version)
        }
      case t =>
        logger.info("Failed to handle json update. Tried: " + t)
        Failure(Messages("format.json.invalid"))
    }
  }

  def isUpdateable(annotationLike: AnnotationLike) = {
    annotationLike match {
      case a: Annotation => Some(a)
      case _             => None
    }
  }

  def isUpdateAllowed(annotation: AnnotationLike, version: Int)(implicit request: SecuredRequest[_]) = {
    if (annotation.restrictions.allowUpdate(request.identity))
      Full(version == annotation.version + 1)
    else
      Failure(Messages("notAllowed")) ~> FORBIDDEN
  }

  def executeUpdateIfAllowed(oldAnnotation: Annotation, isAllowed: Boolean, updates: JsValue, version: Int, user: User, clientTimestamp: Long)(implicit request: SecuredRequest[_]) = {
    if (isAllowed)
      for {
        result <- handleUpdates(oldAnnotation, updates, version, clientTimestamp)
      } yield {
        JsonOk(result, "annotation.saved")
      }
    else {
      for {
        oldJs <- oldAnnotation.annotationInfo(Some(user))
      } yield {
        new JsonResult(CONFLICT)(oldJs, Messages("annotation.dirtyState"))
      }
    }
  }

  def updateWithJson(typ: String, id: String, version: Int) = SecuredAction.async(parse.json(maxLength = 8388608)) { implicit request =>
    // Logger.info(s"Tracing update [$typ - $id, $version]: ${request.body}")
    AnnotationUpdateService.store(typ, id, version, request.body)
    val clientTimestamp = request.headers.get("x-date").flatMap(s => Try(s.toLong).toOption).getOrElse(System.currentTimeMillis)

    for {
      oldAnnotation <- findAnnotation(typ, id)(securedRequestToUserAwareRequest)
      updateableAnnotation <- isUpdateable(oldAnnotation) ?~> Messages("annotation.update.impossible")
      isAllowed <- isUpdateAllowed(oldAnnotation, version).toFox
      result <- executeUpdateIfAllowed(updateableAnnotation, isAllowed, request.body, version, request.identity, clientTimestamp)
    } yield {
      result
    }
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

  def finish(typ: String, id: String) = SecuredAction.async { implicit request =>
    for {
      (updated, message) <- finishAnnotation(typ, id, request.identity)(GlobalAccessContext)
      json <- annotationJson(request.identity, updated,  List("content"))
    } yield {
      JsonOk(json, Messages(message))
    }
  }

  def finishAll(typ: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonAs[JsArray](request.body \ "annotations") { annotationIds =>
      val results = Fox.serialSequence(annotationIds.value.toList){jsValue =>
        jsValue.asOpt[String].toFox.flatMap(id => finishAnnotation(typ, id, request.identity)(GlobalAccessContext))
      }

      results.map { results =>
        JsonOk(Messages("annotation.allFinished"))
      }
    }
  }

  def finishWithRedirect(typ: String, id: String) = SecuredAction.async { implicit request =>
    val redirectTarget = if(!request.identity.isAnonymous) "/dashboard" else "/thankyou"

    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      finished <- annotation.muta.finishAnnotation(request.identity).futureBox
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

  def editAnnotation(typ: String, id: String) = SecuredAction.async(parse.json) { implicit request =>

    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      muta = annotation.muta
      _ <- (request.body \ "name").asOpt[String].map(muta.rename).getOrElse(Fox.successful(())) ?~> Messages("annotation.edit.failed")
      _ <- (request.body \ "isPublic").asOpt[Boolean].map(muta.setIsPublic).getOrElse(Fox.successful(())) ?~> Messages("annotation.edit.failed")
      _ <- (request.body \ "tags").asOpt[List[String]].map(muta.setTags).getOrElse(Fox.successful(())) ?~> Messages("annotation.edit.failed")
    } yield {
      JsonOk(Messages("annotation.edit.success"))
    }
  }

  def empty(implicit sessionData: oxalis.view.SessionData) = {
    views.html.main()(Html(""))
  }

  def annotationsForTask(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task.team)
      annotations <- task.annotations
      jsons <- Fox.serialSequence(annotations)(annotationJson(request.identity, _, exclude = List("content")))
    } yield {
      Ok(JsArray(jsons.flatten))
    }
  }

  def cancel(typ: String, id: String) = SecuredAction.async { implicit request =>
    def tryToCancel(annotation: AnnotationLike) = {
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
        _ <- ensureTeamAdministration(request.identity, annotation.team)
        result <- tryToCancel(annotation)
      } yield {
        UsedAnnotationDAO.removeAll(AnnotationIdentifier(typ, id))
        result
      }
    }(securedRequestToUserAwareRequest)
  }

  def transfer(typ: String, id: String) = SecuredAction.async(parse.json) { implicit request =>
    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      userId <- (request.body \ "userId").asOpt[String].toFox
      user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
      result <- annotation.muta.transferToUser(user)
    } yield {
      JsonOk(Messages("annotation.transfered"))
    }
  }

  def duplicate(typ: String, id: String) = SecuredAction.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        content <- annotation.content
        temp <- content.temporaryDuplicate(BSONObjectID.generate().stringify)
        clonedContent <- temp.saveToDB
        dataSet <- DataSetDAO.findOneBySourceName(
          content.dataSetName) ?~> Messages("dataSet.notFound", content.dataSetName)
        clonedAnnotation <- AnnotationService.createFrom(
          request.identity, clonedContent, AnnotationType.Explorational, None) ?~> Messages("annotation.create.failed")
      } yield {
        Redirect(routes.AnnotationController.trace(clonedAnnotation.typ, clonedAnnotation.id))
      }
    }(securedRequestToUserAwareRequest)
  }
}
