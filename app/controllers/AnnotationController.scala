package controllers

import javax.inject.Inject

import akka.util.Timeout
import com.scalableminds.braingames.datastore.tracings.TracingType
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.{Annotation, _}
import models.binary.DataSetDAO
import models.task.TaskDAO
import models.user.time._
import models.user.{UsedAnnotationDAO, User, UserDAO}
import net.liftweb.common.{Full, _}
import oxalis.security.Secured
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{JsArray, _}
import play.twirl.api.Html

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 01.06.13
 * Time: 02:09
 */
class AnnotationController @Inject()(val messagesApi: MessagesApi)
  extends Controller
    with Secured
    with FoxImplicits
    with AnnotationInformationProvider {

  implicit val timeout = Timeout(5 seconds)

  def info(typ: String, id: String, readOnly: Boolean = false) = UserAwareAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)

    withAnnotation(annotationId) { annotation =>
      for {
        restrictions <- restrictionsFor(annotationId)
        _ <- restrictions.allowAccess(request.userOpt) ?~> "notAllowed" ~> BAD_REQUEST
        js <- annotation.toJson(request.userOpt, Some(restrictions), Some(readOnly))
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

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String) = Authenticated.async { implicit request =>
    for {
      mergedAnnotation <- AnnotationMerger.mergeTwoByIds(id, typ, mergedId, mergedTyp, true)
      restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(mergedAnnotation)
      _ <- restrictions.allowAccess(request.user) ?~> Messages("notAllowed") ~> BAD_REQUEST
      savedAnnotation <- mergedAnnotation.saveToDB
      json <- savedAnnotation.toJson(Some(request.user), Some(restrictions))
    } yield {
      JsonOk(json, Messages("annotation.merge.success"))
    }
  }


  def loggedTime(typ: String, id: String) = Authenticated.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    withAnnotation(annotationId) { annotation =>
      for {
        restrictions <- restrictionsFor(annotationId)
        _ <- restrictions.allowAccess(request.user) ?~> Messages("notAllowed") ~> BAD_REQUEST
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
    for {
      annotation <- findAnnotation(typ, id)
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      _ <- restrictions.allowUpdate(request.user) ?~> Messages("notAllowed")
      _ <- annotation.isRevertPossible ?~> Messages("annotation.revert.toOld")
      dataSet <- DataSetDAO.findOneBySourceName(
        annotation.dataSetName).toFox ?~> Messages("dataSet.notFound", annotation.dataSetName)
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(annotation.tracingReference, Some(version.toString))
      _ <- AnnotationDAO.updateTracingRefernce(annotation._id, newTracingReference)
    } yield {
      logger.info(s"REVERTED [$typ - $id, $version]")
      JsonOk("annotation.reverted")
    }
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

  def createExplorational(dataSetName: String, typ: String) = Authenticated.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      contentType <- TracingType.values.find(_.toString == typ).toFox
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

  private def finishAnnotation(typ: String, id: String, user: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    for {
      annotation <- AnnotationDAO.findOneById(id) ?~> Messages("annotation.notFound")
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      (updated, message) <- annotation.muta.finishAnnotation(user, restrictions)
    } yield {
      TimeSpanService.logUserInteraction(user, Some(annotation))         // log time on a tracings end
      (updated, message)
    }
  }

  def finish(typ: String, id: String) = Authenticated.async { implicit request =>
    for {
      (updated, message) <- finishAnnotation(typ, id, request.user)(GlobalAccessContext)
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      json <- updated.toJson(Some(request.user), Some(restrictions))
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
      restrictions <- restrictionsFor(AnnotationIdentifier(id, typ))
      finished <- annotation.muta.finishAnnotation(request.user, restrictions).futureBox
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

  def editAnnotation(typ: String, id: String) = Authenticated.async(parse.json) { implicit request =>

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
  def empty(typ: String, id: String) = Authenticated { implicit request =>
    Ok(views.html.main()(Html("")))
  }
  def traceReadOnly(typ: String, id: String) = UserAwareAction { implicit request =>
    Ok(empty)
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
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        newAnnotation <- duplicateAnnotation(annotation, request.user)
      } yield {
        Redirect(routes.AnnotationController.empty(newAnnotation.typ, newAnnotation.id))
      }
    }
  }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(
        annotation.dataSetName).toFox ?~> Messages("dataSet.notFound", annotation.dataSetName)
      oldTracingReference = annotation.tracingReference
      dataSource <- dataSet.dataSource.toUsable ?~> "DataSet is not imported."
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(oldTracingReference) ?~> "Failed to create skeleton tracing."
      clonedAnnotation <- AnnotationService.createFrom(
        user, dataSet, newTracingReference, AnnotationType.Explorational, annotation.settings, None) ?~> Messages("annotation.create.failed")
    } yield clonedAnnotation
  }
}
