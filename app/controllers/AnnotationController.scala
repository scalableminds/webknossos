package controllers

import braingames.mvc.Controller
import oxalis.security.{AuthenticatedRequest, Secured}
import models.security.Role
import models.user.{User, TimeTracking, UsedAnnotation}
import play.api.i18n.Messages
import play.api.libs.json.{JsObject, JsValue, Json, JsArray}
import play.api.Logger
import models.annotation.{AnnotationLike, AnnotationType, AnnotationDAO, Annotation}
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.{Failure, Full, Box}
import controllers.admin.NMLIO
import models.task.{Project, Task}
import views.html
import play.api.templates.Html
import oxalis.annotation.{AnnotationService, RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import akka.util.Timeout
import scala.concurrent.duration._
import play.api.libs.iteratee.Enumerator
import models.binary.DataSetDAO
import play.api.libs.iteratee.Input.EOF
import scala.concurrent.Future

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
object AnnotationController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User

  implicit val timeout = Timeout(5 seconds)

  def info(typ: String, id: String) = UserAwareAction {
    implicit request =>
      Async {
        val annotationId = AnnotationIdentifier(typ, id)
        respondWithTracingInformation(annotationId).map {
          js =>
            request.userOpt.map{ user =>
              UsedAnnotation.use(user, annotationId)
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
      Async {
        (for {
          oldAnnotation <- findAnnotation(typ, id)
          oldJs <- oldAnnotation.annotationInfo(Some(request.user))
          if (oldAnnotation.restrictions.allowUpdate(request.user))
        } yield {
          if (version == oldAnnotation.version + 1) {
            request.body match {
              case JsArray(jsUpdates) =>
                AnnotationDAO.updateFromJson(jsUpdates, oldAnnotation) match {
                  case Some(annotation) =>
                    TimeTracking.logUserAction(request.user, annotation)
                    JsonOk(Json.obj("version" -> version), "tracing.saved")
                  case _ =>
                    JsonBadRequest("Invalid update Json")
                }
              case _ =>
                Logger.error("Invalid update json.")
                JsonBadRequest("Invalid update Json")
            }
          } else
            JsonBadRequest(oldJs, "tracing.dirtyState")
        }) ?~> Messages("notAllowed") ~> 403
      }
  }

  def finishAnnotation(user: User, annotation: Annotation): Box[(Annotation, String)] = {
    def tryToFinish() = {
      if (annotation.restrictions.allowFinish(user)) {
        if (annotation.state.isInProgress) {
          annotation match {
            case annotation if annotation._task.isEmpty =>
              Full(annotation.update(_.finish) -> Messages("annotation.finished"))
            case annotation if annotation.isTrainingsAnnotation() =>
              Full(annotation.update(_.passToReview) -> Messages("task.passedToReview"))
            case annotation if annotation.isReadyToBeFinished =>
              Full(annotation.update(_.finish) -> Messages("task.finished"))
            case _ =>
              Failure(Messages("tracing.notEnoughNodes"))
          }
        } else
          Failure(Messages("annotation.notInProgress"))
      } else
        Failure(Messages("annotation.notPossible"))
    }

    tryToFinish().map {
      result =>
        AnnotationService.writeAnnotationToFile(annotation)
        UsedAnnotation.removeAll(annotation.id)
        result
    }
  }

  def finish(typ: String, id: String) = Authenticated {
    implicit request =>
    // TODO: RF - user Store
      for {
        oldAnnotation <- AnnotationDAO.findOneById(id) ?~ Messages("annotation.notFound")
        (annotation, message) <- finishAnnotation(request.user, oldAnnotation)
      } yield {
        if(annotation.typ != AnnotationType.Task)
          JsonOk(message)
        else
          (for {
            task <- annotation.task ?~ Messages("tracing.task.notFound")
          } yield {
            JsonOk(
              html.user.dashboard.taskAnnotationTableItem(task, annotation),
              Json.obj("hasAnOpenTask" -> AnnotationDAO.hasAnOpenAnnotation(request.user, AnnotationType.Task)),
              message)
          }).asResult
      }
  }

  def finishWithRedirect(typ: String, id: String) = Authenticated {
    implicit request =>
    // TODO: RF - user store
      for {
        annotation <- AnnotationDAO.findOneById(id) ?~ Messages("annotation.notFound")
      } yield {
        finishAnnotation(request.user, annotation) match {
          case Full((_, message)) =>
            Redirect(routes.UserController.dashboard).flashing("success" -> message)
          case Failure(message, _, _) =>
            Redirect(routes.UserController.dashboard).flashing("error" -> message)
          case _ =>
            Redirect(routes.UserController.dashboard).flashing("error" -> Messages("error.unknown"))
        }
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
          html.user.dashboard.explorativeAnnotationTableItem(updated),
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
