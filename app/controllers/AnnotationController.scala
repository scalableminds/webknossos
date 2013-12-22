package controllers

import oxalis.security.{AuthenticatedRequest, Secured}
import models.security.{RoleDAO, Role}
import models.user.{UsedAnnotationDAO, User, UsedAnnotation}
import play.api.i18n.Messages
import play.api.libs.json._
import play.api.Logger
import models.annotation._
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.{Failure, Full, Box}
import controllers.admin.NMLIO
import views.html
import play.api.templates.Html
import oxalis.annotation.AnnotationIdentifier
import akka.pattern.ask
import akka.util.Timeout
import scala.concurrent.duration._
import play.api.libs.iteratee.Enumerator
import models.binary.DataSetDAO
import play.api.libs.iteratee.Input.EOF
import scala.concurrent.Future
import models.user.time.{TimeTrackingService, TimeTracking}
import braingames.reactivemongo.DBAccessContext
import oxalis.annotation.AnnotationIdentifier
import net.liftweb.common.Full
import scala.Some
import play.api.i18n.Messages.Message
import braingames.util.Fox
import oxalis.annotation.AnnotationIdentifier
import play.api.libs.json.JsArray
import net.liftweb.common.Full
import scala.Some
import models.annotation.Annotation
import braingames.mvc.JsonResult
import play.api.mvc.Action
import models.task.Task

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
object AnnotationController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = RoleDAO.User

  implicit val timeout = Timeout(5 seconds)

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

  def trace(typ: String, id: String) = Authenticated().async {
    implicit request =>
      withAnnotation(AnnotationIdentifier(typ, id)) {
        annotation =>
          if (annotation.restrictions.allowAccess(request.user)) {
            // TODO: RF -allow all modes
            htmlForAnnotation(annotation).map( html => Full(Ok(html)))
          } else
            Future.successful(Failure(Messages("notAllowed")) ~> 403)
      }
  }

  def download(typ: String, id: String) = Authenticated().async {
    implicit request =>
      withAnnotation(AnnotationIdentifier(typ, id)) {
        annotation =>
          (for {
            annotationName <- nameAnnotation(annotation) ?~> Messages("annotation.name.impossible")
            isAllowed <- annotation.restrictions.allowDownload(request.user)
            if isAllowed
            content <- annotation.content ?~> Messages("annotation.content.empty")
            stream <- content.toDownloadStream
          } yield {
            Ok.stream(Enumerator.fromStream(stream).andThen(Enumerator.eof[Array[Byte]])).withHeaders(
              CONTENT_TYPE ->
                "application/octet-stream",
              CONTENT_DISPOSITION ->
                s"filename=${annotationName + content.downloadFileExtension}")
          }) ?~> Messages("annotation.download.notAllowed")
      }
  }

  def createExplorational = Authenticated().async(parse.urlFormEncoded) {
    implicit request =>
      for {
        dataSetName <- postParameter("dataSetName") ?~> Messages("dataSet.notSupplied")
        dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
        contentType <- postParameter("contentType") ?~> Messages("annotation.contentType.notSupplied")
        annotation <- AnnotationService.createExplorationalFor(request.user, dataSet, contentType) ?~> Messages("annotation.create.failed")
      } yield {
        Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
      }
  }


  def updateWithJson(typ: String, id: String, version: Int) = Authenticated().async(parse.json(maxLength = 2097152)) {
    implicit request =>
      def handleUpdates(oldAnnotation: Annotation, js: JsValue): Fox[JsObject] = {
        js match {
          case JsArray(jsUpdates) =>
            for {
              annotation <- AnnotationService.updateFromJson(jsUpdates, oldAnnotation) ?~> Messages("format.json.invalid")
            } yield {
              TimeTrackingService.logUserAction(request.user, annotation)
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

  def finish(typ: String, id: String) = Authenticated().async {
    implicit request =>
      def generateJsonResult(annotation: Annotation, message: String) = {
        if (annotation.typ != AnnotationType.Task)
          Fox.successful((JsonOk(message)))
        else
          for {
            task <- annotation.task ?~> Messages("tracing.task.notFound")
            hasOpen <- AnnotationService.hasAnOpenTask(request.user)
          } yield {
            JsonOk(
              // html.user.dashboard.taskAnnotationTableItem(task, annotation),
              Json.obj(
                "task" -> task,
                "annotation" -> annotation,
                "hasAnOpenTask" -> hasOpen),
                message)
          }
      }

      for {
        oldAnnotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        (annotation, message) <- AnnotationService.finishAnnotation(request.user, oldAnnotation)
        result <- generateJsonResult(annotation, message)
      } yield {
        result
      }
  }

  def finishWithRedirect(typ: String, id: String) = Authenticated().async {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        finished <- AnnotationService.finishAnnotation(request.user, annotation).futureBox
      } yield {
        finished match {
          case Full((_, message)) =>
            Redirect(routes.UserController.dashboard).flashing("success" -> message)
          case Failure(message, _, _) =>
            Redirect(routes.UserController.dashboard).flashing("error" -> message)
          case _ =>
            Redirect(routes.UserController.dashboard).flashing("error" -> Messages("error.unknown"))
        }
      }
  }

  def nameExplorativeAnnotation(typ: String, id: String) = Authenticated().async(parse.urlFormEncoded) {
    implicit request =>
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
        name <- postParameter("name") ?~> Messages("tracing.invalidName")
        renamed <- AnnotationService.rename(annotation, name).toFox
      } yield {
        JsonOk(
          Json.obj("TODO" -> "html.user.dashboard.exploratoryAnnotationTableItem(renamed)"),
          Messages("tracing.setName"))
      }
  }

  def additionalHtml(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = {
    if (annotation.typ == AnnotationType.Review) {
      AnnotationDAO.findTrainingForReviewAnnotation(annotation).map {
        annotation =>
          html.admin.training.trainingsReviewItem(annotation, admin.TrainingsTracingAdministration.reviewForm)
      }
    } else {
      annotation.review.headOption.flatMap(_.comment).toFox.map(comment =>
        html.tracing.trainingsComment(comment))
    }
  }

  def htmlForAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = {
    additionalHtml(annotation).getOrElse(Html.empty).map{ additionalHtml =>
      html.tracing.trace(annotation)(additionalHtml)
    }
  }


  def traceJSON(typ: String, id: String) = Authenticated().async {
    implicit request => {
      withAnnotation(AnnotationIdentifier(typ, id)) {
        annotation =>
          if (annotation.restrictions.allowAccess(request.user)) {
            // TODO: RF -allow all modes
            jsonForAnnotation(annotation)
          } else
            Future.successful(Failure(Messages("notAllowed")) ~> 403)
      }
    }
  }

  def jsonForAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = {
    annotation.task.flatMap( Task.transformToJson(_).map(JsonOk(_)) )
  }
}
