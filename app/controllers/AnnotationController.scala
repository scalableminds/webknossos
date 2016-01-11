package controllers

import javax.inject.Inject

import scala.async.Async._
import scala.concurrent._

import akka.util.Timeout
import com.scalableminds.util.mvc.JsonResult
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBoolean
import com.scalableminds.util.tools.Fox
import models.annotation.{Annotation, _}
import models.binary.DataSetDAO
import models.task.TaskDAO
import models.user.time._
import models.user.{UsedAnnotationDAO, User, UserDAO}
import net.liftweb.common.{Full, _}
import oxalis.annotation.AnnotationIdentifier
import oxalis.security.{AuthenticatedRequest, Secured}
import play.api.Logger
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.{JsArray, JsObject, _}
import play.twirl.api.Html
import scala.concurrent.duration._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
class AnnotationController @Inject()(val messagesApi: MessagesApi) extends Controller with Secured with TracingInformationProvider {

  implicit val timeout = Timeout(5 seconds)

  def annotationJson(user: User, annotation: AnnotationLike, exclude: List[String] = Nil)(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), exclude)

  def info(typ: String, id: String, readOnly: Boolean = false) = UserAwareAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    respondWithTracingInformation(annotationId, readOnly).map { js =>
      request.userOpt.map { user =>
        UsedAnnotationDAO.use(user, annotationId)
      }
      Ok(js)
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String, readOnly: Boolean) = Authenticated.async { implicit request =>
    withMergedAnnotation(typ, id, mergedId, mergedTyp, readOnly) { annotation =>
      for {
        _ <- annotation.restrictions.allowAccess(request.user).failIfFalse(Messages("notAllowed")).toFox ~> 400
        temporary <- annotation.temporaryDuplicate(true)
        explorational = temporary.copy(typ = AnnotationType.Explorational)
        savedAnnotation <- explorational.saveToDB
        json <- annotationJson(request.user, savedAnnotation)
      } yield {
        //Redirect(routes.AnnotationController.trace(savedAnnotation.typ, savedAnnotation.id))
        JsonOk(json, Messages("annotation.merge.success"))
      }
    }
  }

  def trace(typ: String, id: String) = Authenticated { implicit request =>
    Ok(empty)
  }

  def revert(typ: String, id: String, version: Int) = Authenticated.async { implicit request =>
    def combineUpdates(updates: List[AnnotationUpdate]) = updates.foldLeft(Seq.empty[JsValue]) {
      case (updates, AnnotationUpdate(_, _, _, JsArray(nextUpdates), _)) =>
        updates ++ nextUpdates
      case (updates, u)                                                  =>
        Logger.warn("dropping update during replay! Update: " + u)
        updates
    }

    for {
      oldAnnotation <- findAnnotation(typ, id)
      _ <- isUpdateAllowed(oldAnnotation, version).toFox
      updates <- AnnotationUpdateService.retrieveAll(typ, id, maxVersion = version)
      updatedAnnotation <- oldAnnotation.muta.resetToBase()
      combinedUpdate = JsArray(combineUpdates(updates))
      updateableAnnotation <- isUpdateable(updatedAnnotation) ?~> Messages("annotation.update.impossible")
      result <- handleUpdates(updateableAnnotation, combinedUpdate, version)
      _ <- AnnotationUpdateService.removeAll(typ, id)
    } yield {
      AnnotationUpdateService.store(typ, id, updateableAnnotation.version + 1, combinedUpdate)
      Logger.info(s"REVERTED using update [$typ - $id, $version]: ${combinedUpdate}")
      JsonOk(result, "annotation.reverted")
    }
  }

  def reset(typ: String, id: String) = Authenticated.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.user, annotation.team).toFox
        reset <- annotation.muta.resetToBase() ?~> Messages("annotation.reset.failed")
        json <- annotationJson(request.user, reset)
      } yield {
        JsonOk(json, Messages("annotation.reset.success"))
      }
    }
  }

  def reopen(typ: String, id: String) = Authenticated.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.user, annotation.team).toFox
        reopenedAnnotation <- annotation.muta.reopen() ?~> Messages("annotation.invalid")
        json <- annotationJson(request.user, reopenedAnnotation)
      } yield {
        JsonOk(json, Messages("annotation.reopened"))
      }
    }
  }

  def download(typ: String, id: String) = Authenticated.async {
    implicit request =>
      withAnnotation(AnnotationIdentifier(typ, id)) {
        annotation =>
          for {
            name <- nameAnnotation(annotation) ?~> Messages("annotation.name.impossible")
            _ <- annotation.restrictions.allowDownload(request.user).failIfFalse(Messages("annotation.download.notAllowed")).toFox
            annotationDAO <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
            content <- annotation.content ?~> Messages("annotation.content.empty")
            stream <- content.toDownloadStream
          } yield {
            Ok.chunked(stream.andThen(Enumerator.eof[Array[Byte]])).withHeaders(
              CONTENT_TYPE ->
                "application/octet-stream",
              CONTENT_DISPOSITION ->
                s"filename=${name + content.downloadFileExtension}")
          }
      }
  }

  def createExplorational = Authenticated.async(parse.urlFormEncoded) {
    implicit request =>
      for {
        dataSetName <- postParameter("dataSetName") ?~> Messages("dataSet.notSupplied")
        dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound")
        contentType <- postParameter("contentType") ?~> Messages("annotation.contentType.notSupplied")
        annotation <- AnnotationService.createExplorationalFor(request.user, dataSet, contentType) ?~> Messages("annotation.create.failed")
      } yield {
        Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
      }
  }

  def handleUpdates(annotation: Annotation, js: JsValue, version: Int)(implicit request: AuthenticatedRequest[_]): Fox[JsObject] = {
    js match {
      case JsArray(jsUpdates) =>
        Logger.info("Tried: " + jsUpdates)
        for {
          updated <- annotation.muta.updateFromJson(jsUpdates) //?~> Messages("format.json.invalid")
        } yield {
          TimeSpanService.logUserInteraction(request.user, Some(updated))
          Json.obj("version" -> version)
        }
      case t                  =>
        Logger.info("Failed to handle json update. Tried: " + t)
        Failure(Messages("format.json.invalid"))
    }
  }

  def isUpdateable(annotationLike: AnnotationLike) = {
    annotationLike match {
      case a: Annotation => Some(a)
      case _             => None
    }
  }

  def isUpdateAllowed(annotation: AnnotationLike, version: Int)(implicit request: AuthenticatedRequest[_]) = {
    if (annotation.restrictions.allowUpdate(request.user))
      Full(version == annotation.version + 1)
    else
      Failure(Messages("notAllowed")) ~> 403
  }

  def updateWithJson(typ: String, id: String, version: Int) = Authenticated.async(parse.json(maxLength = 2097152)) { implicit request =>
    def executeIfAllowed(oldAnnotation: Annotation, isAllowed: Boolean, oldJs: JsObject) = {
      if (isAllowed)
        for {
          result <- handleUpdates(oldAnnotation, request.body, version)
        } yield {
          JsonOk(result, "annotation.saved")
        }
      else
        new Fox(Future.successful(Full(new JsonResult(CONFLICT)(oldJs, Messages("annotation.dirtyState")))))
    }

    // Logger.info(s"Tracing update [$typ - $id, $version]: ${request.body}")
    AnnotationUpdateService.store(typ, id, version, request.body)

    for {
      oldAnnotation <- findAnnotation(typ, id)
      updateableAnnotation <- isUpdateable(oldAnnotation) ?~> Messages("annotation.update.impossible")
      isAllowed <- isUpdateAllowed(oldAnnotation, version).toFox
      oldJs <- oldAnnotation.annotationInfo(Some(request.user))
      result <- executeIfAllowed(updateableAnnotation, isAllowed, oldJs)
    } yield {
      result
    }
  }

  def finishAnnotation(typ: String, id: String, user: User)(implicit ctx: DBAccessContext): Fox[(JsObject, String)] = {
    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      (updated, message) <- annotation.muta.finishAnnotation(user)
      json <- annotationJson(user, updated)
    } yield (json, message)
  }

  def finish(typ: String, id: String) = Authenticated.async { implicit request =>
    for {
      (json, message) <- finishAnnotation(typ, id, request.user)(GlobalAccessContext)
    } yield {
      JsonOk(json, message)
    }
  }

  def finishAll(typ: String) = Authenticated.async(parse.json) {
    implicit request =>
      (request.body \ "annotations").validate[JsArray] match {
        case JsSuccess(annotationIds, _) =>
          val results: List[Fox[(JsObject, String)]] = (for {
            jsValue <- annotationIds.value
            id <- jsValue.asOpt[String]
          } yield finishAnnotation(typ, id, request.user)(GlobalAccessContext)).toList

          Fox.sequence(results) map { results =>
            JsonOk(Messages("annotation.allFinished"))
          }
        case e: JsError                  =>
          Future.successful(JsonBadRequest(JsError.toFlatJson(e)))
      }
  }

  def finishWithRedirect(typ: String, id: String) = Authenticated.async {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        finished <- annotation.muta.finishAnnotation(request.user).futureBox
      } yield {
        finished match {
          case Full((_, message))     =>
            Redirect("/dashboard").flashing("success" -> message)
          case Failure(message, _, _) =>
            Redirect("/dashboard").flashing("error" -> message)
          case _                      =>
            Redirect("/dashboard").flashing("error" -> Messages("error.unknown"))
        }
      }
  }

  def nameExplorativeAnnotation(typ: String, id: String) = Authenticated.async(parse.urlFormEncoded) {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        name <- postParameter("name") ?~> Messages("annotation.invalidName")
        updated <- annotation.muta.rename(name).toFox
        renamedJSON <- Annotation.transformToJson(updated)
      } yield {
        JsonOk(
          Json.obj("annotations" -> renamedJSON),
          Messages("annotation.setName"))
      }
  }

  def empty(implicit request: AuthenticatedRequest[_]) = {
    views.html.main()(Html(""))
  }

  def annotationsForTask(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team).toFox
      annotations <- task.annotations
      jsons <- Fox.sequence(annotations.map(annotationJson(request.user, _, exclude = List("content"))))
    } yield {
      Ok(JsArray(jsons.flatten))
    }
  }

  def cancel(typ: String, id: String) = Authenticated.async { implicit request =>
    def tryToCancel(annotation: AnnotationLike) = async {
      annotation match {
        case t if t.typ == AnnotationType.Task =>
          await(annotation.muta.cancelTask().futureBox).map { _ =>
            Ok
          }
        case _                                 =>
          Full(JsonOk(Messages("annotation.finished")))
      }
    }
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.user, annotation.team).toFox
        result <- tryToCancel(annotation)
      } yield {
        UsedAnnotationDAO.removeAll(annotation.id)
        result
      }
    }
  }

  def transfer(typ: String, id: String) = Authenticated.async(parse.json) {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id).toFox ?~> Messages("annotation.notFound")
        userId <- (request.body \ "userId").asOpt[String].toFox
        user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
        result <- annotation.muta.transferToUser(user)
      } yield {
        Ok
      }
  }
}
