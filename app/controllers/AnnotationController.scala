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

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
object AnnotationController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = RoleDAO.User

  implicit val timeout = Timeout(5 seconds)

  def info(typ: String, id: String) = UserAwareAction {
    implicit request =>
      Async {
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
  }

  def trace(typ: String, id: String) = Authenticated {
    implicit request =>
      Async {
        withAnnotation(typ, id) {
          annotation =>
            if (annotation.restrictions.allowAccess(request.user)) {
              // TODO: RF -allow all modes
              Full(Ok(htmlForAnnotation(annotation)))
            } else
              Failure(Messages("notAllowed")) ~> 403
        }
      }
  }

  def download(typ: String, id: String) = Authenticated {
    implicit request =>
      Async {
        withAnnotation(AnnotationIdentifier(typ, id)) {
          annotation =>
            (for {
              annotationName <- nameAnnotation(annotation) ?~> Messages("annotation.name.impossible")
              if annotation.restrictions.allowDownload(request.user)
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
  }

  def createExplorational = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      Async {
        for {
          dataSetName <- postParameter("dataSetName") ?~> Messages("dataSet.notSupplied")
          dataSet <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound")
          contentType <- postParameter("contentType") ?~> Messages("annotation.contentType.notSupplied")
          annotation <- AnnotationDAO.createExplorationalFor(request.user, dataSet, contentType) ?~> Messages("annotation.create.failed")
        } yield {
          Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
        }
      }
  }


  def updateWithJson(typ: String, id: String, version: Int) = Authenticated(parse.json(maxLength = 2097152)) {
    implicit request =>
      def handleUpdates(oldAnnotation: AnnotationLike, js: JsValue): Fox[JsObject] = {
        js match {
          case JsArray(jsUpdates) =>
            for {
              annotation <- AnnotationDAO.updateFromJson(jsUpdates, oldAnnotation) ?~> Messages("format.json.invalid")
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

      def executeIfAllowed(oldAnnotation: AnnotationLike, isAllowed: Boolean, oldJs: JsObject) = {
        if (isAllowed)
          for {
            result <- handleUpdates(oldAnnotation, request.body)
          } yield {
            JsonOk(result, "tracing.saved")
          }
        else
          new Fox(Future.successful(Full(JsonBadRequest(oldJs, "tracing.dirtyState"))))
      }

      Async {
        for {
          oldAnnotation <- findAnnotation(typ, id)
          oldJs <- oldAnnotation.annotationInfo(Some(request.user))
          isAllowed <- isUpdateAllowed(oldAnnotation).toFox
          result <- executeIfAllowed(oldAnnotation, isAllowed, oldJs)
        } yield {
          result
        }
      }
  }

  def finish(typ: String, id: String) = Authenticated {
    implicit request =>
    // TODO: RF - user Store
      Async {
        for {
          oldAnnotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
          (annotation, message) <- AnnotationService.finishAnnotation(request.user, oldAnnotation)
        } yield {
          if (annotation.typ != AnnotationType.Task)
            JsonOk(message)
          else
            (for {
              task <- annotation.task ?~ Messages("tracing.task.notFound")
            } yield {
              JsonOk(
                html.user.dashboard.taskAnnotationTableItem(task, annotation),
                Json.obj("hasAnOpenTask" -> AnnotationService.hasAnOpenTask(request.user)),
                message)
            }).asResult
        }
      }
  }

  def finishWithRedirect(typ: String, id: String) = Authenticated {
    implicit request =>
    // TODO: RF - user store
      AnnotationDAO.findOneById(id) match {
        case Some(annotation) => Async {
          AnnotationService.finishAnnotation(request.user, annotation).futureBox.map {
            case Full((_, message)) =>
              Redirect(routes.UserController.dashboard).flashing("success" -> message)
            case Failure(message, _, _) =>
              Redirect(routes.UserController.dashboard).flashing("error" -> message)
            case _ =>
              Redirect(routes.UserController.dashboard).flashing("error" -> Messages("error.unknown"))
          }
        }
        case _ =>
          BadRequest(Messages("annotation.notFound"))
      }
  }

  def nameExplorativeAnnotation(typ: String, id: String) = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
    // TODO: RF - user store
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~ Messages("annotation.notFound")
        name <- postParameter("name") ?~ Messages("tracing.invalidName")
      } yield {
        val updated = annotation.update(_.copy(_name = Some(name)))
        JsonOk(
          html.user.dashboard.exploratoryAnnotationTableItem(updated),
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
      annotation.review.headOption.flatMap(_.comment).map(comment =>
        html.tracing.trainingsComment(comment))
    }
  }

  def htmlForAnnotation(annotation: AnnotationLike)(implicit request: AuthenticatedRequest[_]) = {
    html.tracing.trace(annotation)(additionalHtml(annotation).getOrElse(Html.empty))
  }
}
