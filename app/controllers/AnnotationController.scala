package controllers

import braingames.mvc.Controller
import oxalis.security.{AuthenticatedRequest, Secured}
import models.security.Role
import models.user.{User, TimeTracking, UsedAnnotation}
import play.api.i18n.Messages
import play.api.libs.json.{Json, JsArray}
import play.api.Logger
import models.annotation.{AnnotationLike, AnnotationType, AnnotationDAO, Annotation}
import play.api.libs.concurrent.Execution.Implicits._
import net.liftweb.common.{Failure, Full, Box}
import controllers.admin.NMLIO
import models.task.{Project, Task}
import views.html
import play.api.templates.Html
import oxalis.annotation.{RequestAnnotation, AnnotationIdentifier}
import akka.pattern.ask
import akka.util.Timeout
import scala.concurrent.duration._
import play.api.libs.iteratee.Enumerator
import models.binary.DataSetDAO
import play.api.libs.iteratee.Input.EOF

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
object AnnotationController extends Controller with Secured with TracingInformationProvider {
  override val DefaultAccessRole = Role.User

  implicit val timeout = Timeout(5 seconds)

  def index = Authenticated {
    implicit request =>
      UsedAnnotation
        .oneBy(request.user)
        .map(annotationId =>
        Redirect(routes.AnnotationController.trace(annotationId.annotationType, annotationId.identifier)))
        .getOrElse {
        Redirect(routes.UserController.dashboard)
      }
  }

  def info(typ: String, id: String) = Authenticated {
    implicit request =>
      Async {
        val annotationId = AnnotationIdentifier(typ, id)
        respondWithTracingInformation(annotationId).map(_.map {
          js =>
            UsedAnnotation.use(request.user, annotationId)
            Ok(js)
        })
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
        withAnnotation(typ, id) {
          annotation =>
            (for {
              annotationName <- nameAnnotation(annotation)
              if annotation.restrictions.allowDownload(request.user)
              content <- annotation.content
            } yield {
              Ok.stream(Enumerator.fromStream(content.toDownloadStream).andThen(Enumerator.eof[Array[Byte]])).withHeaders(
                CONTENT_TYPE ->
                  "application/octet-stream",
                CONTENT_DISPOSITION ->
                  s"filename=${annotationName + content.downloadFileExtension}")
            }) ?~ Messages("annotation.download.notAllowed")
        }
      }
  }

  def createExplorational(contentType: String) = Authenticated(parser = parse.urlFormEncoded) {
    implicit request =>
      for {
        dataSetName <- postParameter("dataSetName") ?~ Messages("dataSet.notSupplied")
        dataSet <- DataSetDAO.findOneByName(dataSetName) ?~ Messages("dataSet.notFound")
        annotation <- AnnotationDAO.createExplorationalFor(request.user, dataSet, contentType) ?~ Messages("annotation.create.failed")
      } yield {
        Redirect(routes.AnnotationController.trace(annotation.typ, annotation.id))
      }
  }


  def updateWithJson(typ: String, id: String, version: Int) = Authenticated(parse.json(maxLength = 2097152)) {
    implicit request =>
      Async {
        withAnnotation(typ, id) {
          oldAnnotation =>
            if (oldAnnotation.restrictions.allowUpdate(request.user))
              Failure(Messages("notAllowed")) ~> 403
            else {
              Full(
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
                  JsonBadRequest(oldAnnotation.content.map(_.createTracingInformation()) getOrElse Json.obj(), "tracing.dirtyState")

              )
            }
        }
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
      //TODO: RF - write to disk
        UsedAnnotation.removeAll(annotation.id)
        result
    }
  }

  def finish(typ: String, id: String, experimental: Boolean) = Authenticated {
    implicit request =>
      // TODO: RF - user Store
      for {
        oldAnnotation <- AnnotationDAO.findOneById(id) ?~ Messages("annotation.notFound")
        (annotation, message) <- finishAnnotation(request.user, oldAnnotation)
      } yield {
        if (experimental)
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
