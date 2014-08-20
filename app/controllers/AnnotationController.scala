package controllers

import oxalis.security.{AuthenticatedRequest, Secured}
import models.user.{UsedAnnotationDAO, User, UserDAO}
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.Logger
import models.annotation._
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common._
import views.html
import play.api.templates.Html
import akka.util.Timeout
import scala.concurrent.duration._
import play.api.libs.iteratee.Enumerator
import models.binary.DataSetDAO
import scala.concurrent.Future
import models.user.time._
import com.scalableminds.util.reactivemongo.DBAccessContext
import net.liftweb.common.Full
import play.api.i18n.Messages.Message
import com.scalableminds.util.tools.Fox
import oxalis.annotation.AnnotationIdentifier
import models.annotation.Annotation
import models.task.{TaskDAO, Task}
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBoolean
import com.scalableminds.util.tools.ExtendedTypes.ExtendedBooleanFuture
import scala.async.Async._
import play.api.libs.json.JsArray
import scala.Some
import net.liftweb.common.Full
import play.api.libs.json.JsObject

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
object AnnotationController extends Controller with Secured with TracingInformationProvider {

  implicit val timeout = Timeout(5 seconds)

  def annotationJson(user: User, annotation: AnnotationLike)(implicit ctx: DBAccessContext): Fox[JsObject] =
    AnnotationLike.annotationLikeInfoWrites(annotation, Some(user), Nil)

  def info(typ: String, id: String) = UserAwareAction.async {
    implicit request =>
      val annotationId = AnnotationIdentifier(typ, id)
      respondWithTracingInformation(annotationId).map {
        js =>
          request.userOpt.map {
            user =>
              UsedAnnotationDAO.use(user, annotationId)
          }
          Ok(js)
      }
  }

  def merge(typ: String, id: String, mergedId: String) = Authenticated.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- annotation.restrictions.allowAccess(request.user).failIfFalse(Messages("notAllowed")).toFox ~> 400 
        mergedAnnotation <- findAnnotation(AnnotationIdentifier(typ, mergedId))
      } yield {
//        val annotations =
        Ok(htmlForAnnotation(annotation))
      }
    }
  }

  def trace(typ: String, id: String) = Authenticated.async {
    implicit request =>
      withAnnotation(AnnotationIdentifier(typ, id)) {
        annotation =>
          for{
            _ <- annotation.restrictions.allowAccess(request.user).failIfFalse(Messages("notAllowed")).toFox ~> 400
          } yield Ok(htmlForAnnotation(annotation))
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
            annotationName <- nameAnnotation(annotation) ?~> Messages("annotation.name.impossible")
            _ <- annotation.restrictions.allowDownload(request.user).failIfFalse(Messages("annotation.download.notAllowed")).toFox
            content <- annotation.content ?~> Messages("annotation.content.empty")
            stream <- content.toDownloadStream
          } yield {
            Ok.stream(Enumerator.fromStream(stream).andThen(Enumerator.eof[Array[Byte]])).withHeaders(
              CONTENT_TYPE ->
                "application/octet-stream",
              CONTENT_DISPOSITION ->
                s"filename=${annotationName + content.downloadFileExtension}")
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


  def updateWithJson(typ: String, id: String, version: Int) = Authenticated.async(parse.json(maxLength = 2097152)) {
    implicit request =>
      def handleUpdates(annotation: Annotation, js: JsValue): Fox[JsObject] = {
        js match {
          case JsArray(jsUpdates) =>
            for {
              updated <- annotation.muta.updateFromJson(jsUpdates) ?~> Messages("format.json.invalid")
            } yield {
              TimeSpanService.logUserInteraction(request.user, Some(updated))
              Json.obj("version" -> version)
            }
          case _ =>
            Failure(Messages("format.json.invalid"))
        }
      }

      def isUpdateAllowed(annotation: AnnotationLike) = {
        if (annotation.restrictions.allowUpdate(request.user))
          Full(version == annotation.version + 1)
        else
          Failure("notAllowed") ~> 403
      }

      def executeIfAllowed(oldAnnotation: Annotation, isAllowed: Boolean, oldJs: JsObject) = {
        if (isAllowed)
          for {
            result <- handleUpdates(oldAnnotation, request.body)
          } yield {
            JsonOk(result, "tracing.saved")
          }
        else
          new Fox(Future.successful(Full(JsonBadRequest(oldJs, "tracing.dirtyState"))))
      }

      def isUpdateable(annotationLike: AnnotationLike) = {
        annotationLike match{
          case a: Annotation => Some(a)
          case _ => None
        }
      }

      for {
        oldAnnotation <- findAnnotation(typ, id)
        updateableAnnotation <- isUpdateable(oldAnnotation) ?~> Messages("tracing.update.impossible")
        isAllowed <- isUpdateAllowed(oldAnnotation).toFox
        oldJs <- oldAnnotation.annotationInfo(Some(request.user))
        result <- executeIfAllowed(updateableAnnotation, isAllowed, oldJs)
      } yield {
        result
      }
  }

//  def finish(annotationId: String) = Authenticated.async { implicit request =>
//    for {
//      annotation <- AnnotationDAO.findOneById(annotationId) ?~> Messages("annotation.notFound")
//      (updated, message) <- AnnotationService.finishAnnotation(request.user, annotation)
//      html <- extendedAnnotationHtml(request.user, updated)
//    } yield {
//      JsonOk(html, message)
//    }
//  }

  def finish(typ: String, id: String) = Authenticated.async {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        (updated, message) <- annotation.muta.finishAnnotation(request.user)
        json <- annotationJson(request.user, updated)
      } yield {
        JsonOk(json, message)
      }
  }

  def finishWithRedirect(typ: String, id: String) = Authenticated.async {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        finished <- annotation.muta.finishAnnotation(request.user).futureBox
      } yield {
        finished match {
          case Full((_, message)) =>
            Redirect("/dashboard").flashing("success" -> message)
          case Failure(message, _, _) =>
            Redirect("/dashboard").flashing("error" -> message)
          case _ =>
            Redirect("/dashboard").flashing("error" -> Messages("error.unknown"))
        }
      }
  }

  def nameExplorativeAnnotation(typ: String, id: String) = Authenticated.async(parse.urlFormEncoded) {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        name <- postParameter("name") ?~> Messages("tracing.invalidName")
        updated <- annotation.muta.rename(name).toFox
        renamedJSON <- Annotation.transformToJson(updated)
      } yield {
        JsonOk(
          Json.obj("annotations" -> renamedJSON),
          Messages("tracing.setName"))
      }
  }

  def htmlForAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = {
    html.tracing.trace(annotation)(Html.empty)
  }

  def annotationsForTask(taskId: String) = Authenticated.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.user, task.team).toFox
      annotations <- task.annotations
      jsons <- Fox.sequence(annotations.map(annotationJson(request.user, _)))
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
        case _ =>
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
        userId <- (request.body\"userId").asOpt[String].toFox
        user <- UserDAO.findOneById(userId) ?~> Messages("user.notFound")
        result <- annotation.muta.transferToUser(user)
      } yield {
        Ok
      }
  }
}
