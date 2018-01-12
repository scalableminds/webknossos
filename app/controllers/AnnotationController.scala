package controllers

import javax.inject.Inject

import akka.util.Timeout
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.webknossos.schema.Tables._
import models.annotation.{Annotation, _}
import models.binary.DataSetDAO
import models.task.TaskDAO
import models.user.time._
import models.user.{UsedAnnotationDAO, User, UserDAO}
import net.liftweb.common.{Full, _}
import oxalis.security.WebknossosSilhouette.{SecuredAction, UserAwareAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{JsArray, _}
import slick.jdbc.PostgresProfile.api._

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
    with FoxImplicits
    with AnnotationInformationProvider {

  implicit val timeout = Timeout(5 seconds)

  def empty(typ: String, id: String) = SecuredAction { implicit request =>
    Ok(views.html.main())
  }

  def emptyReadOnly(typ: String, id: String) = UserAwareAction { implicit request =>
    Ok(views.html.main())
  }

  def sqlTest = UserAwareAction.async { implicit request =>
    val db = Database.forConfig("postgres")

    //db.run(Testtable.result).map(_.foreach{case TesttableRow(a,b,c) => {val x: Int = a; println(x) } case _ => println("did not match query result")})

    for {
      r <- db.run(Annotations.map(_.tags).result)
    } yield {
      db.close()
      r.headOption match { case Some(aString) => Ok(aString) case _ => Ok("did not match query result")}
    }
  }

  def sqlTest2(id: String) = UserAwareAction.async { implicit request =>
    for {
      annotation <- AnnotationSQLDAO.findOne(ObjectId(id))
    } yield {
      Ok(Json.toJson(annotation))
    }
  }

  def info(typ: String, id: String, readOnly: Boolean = false) = UserAwareAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    withAnnotation(annotationId) { annotation =>
      for {
        restrictions <- restrictionsFor(annotationId)
        _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> BAD_REQUEST
        js <- annotation.toJson(request.identity, Some(restrictions), Some(readOnly))
      } yield {
        request.identity.foreach { user =>
          UsedAnnotationDAO.use(user, annotationId)
          TimeSpanService.logUserInteraction(user, annotation)            // log time when a user starts working
        }
        Ok(js)
      }
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, readOnly = true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String) = SecuredAction.async { implicit request =>
    for {
      mergedAnnotation <- AnnotationMerger.mergeTwoByIds(id, typ, mergedId, mergedTyp, true)
      restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(mergedAnnotation)
      _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
      savedAnnotation <- mergedAnnotation.saveToDB
      json <- savedAnnotation.toJson(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json, Messages("annotation.merge.success"))
    }
  }


  def loggedTime(typ: String, id: String) = SecuredAction.async { implicit request =>
    val annotationId = AnnotationIdentifier(typ, id)
    withAnnotation(annotationId) { annotation =>
      for {
        restrictions <- restrictionsFor(annotationId)
        _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
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

  def revert(typ: String, id: String, version: Int) = SecuredAction.async { implicit request =>
    for {
      annotation <- findAnnotation(typ, id)(securedRequestToUserAwareRequest)
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      _ <- restrictions.allowUpdate(request.identity) ?~> Messages("notAllowed")
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

  def reset(typ: String, id: String) = SecuredAction.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- ensureTeamAdministration(request.identity, annotation.team)
        reset <- annotation.muta.resetToBase() ?~> Messages("annotation.reset.failed")
        json <- reset.toJson(Some(request.identity))
      } yield {
        JsonOk(json, Messages("annotation.reset.success"))
      }
    }(securedRequestToUserAwareRequest)
  }

  def reopen(typ: String, id: String) = SecuredAction.async { implicit request =>
    // Reopening an annotation is allowed if either the user owns the annotation or the user is allowed to administrate
    // the team the annotation belongs to
    def isReopenAllowed(user: User, annotation: Annotation) = {
       annotation._user.contains(user._id) || user.adminTeams.exists(_.team == annotation.team)
    }

    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        _ <- isReopenAllowed(request.identity, annotation) ?~> "reopen.notAllowed"
        reopenedAnnotation <- annotation.muta.reopen() ?~> "annotation.invalid"
        json <- reopenedAnnotation.toJson(Some(request.identity))
      } yield {
        JsonOk(json, Messages("annotation.reopened"))
      }
    }(securedRequestToUserAwareRequest)
  }

  def createExplorational(dataSetName: String, typ: String, withFallback: Option[Boolean]) = SecuredAction.async { implicit request =>
    for {
      dataSet <- DataSetDAO.findOneBySourceName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
      contentType <- TracingType.values.find(_.toString == typ).toFox
      annotation <- AnnotationService.createExplorationalFor(request.identity, dataSet, contentType, withFallback.getOrElse(true)) ?~> Messages("annotation.create.failed")
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
      TimeSpanService.logUserInteraction(user, annotation)         // log time on a tracings end
      (updated, message)
    }
  }

  def finish(typ: String, id: String) = SecuredAction.async { implicit request =>
    for {
      (updated, message) <- finishAnnotation(typ, id, request.identity)(GlobalAccessContext)
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      json <- updated.toJson(Some(request.identity), Some(restrictions))
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
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      finished <- annotation.muta.finishAnnotation(request.identity, restrictions).futureBox
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
      _ <- (request.body \ "description").asOpt[String].map(muta.setDescription).getOrElse(Fox.successful(())) ?~> Messages("annotation.edit.failed")
      _ <- (request.body \ "isPublic").asOpt[Boolean].map(muta.setIsPublic).getOrElse(Fox.successful(())) ?~> Messages("annotation.edit.failed")
      _ <- (request.body \ "tags").asOpt[List[String]].map(muta.setTags).getOrElse(Fox.successful(())) ?~> Messages("annotation.edit.failed")
    } yield {
      JsonOk(Messages("annotation.edit.success"))
    }
  }

  def annotationsForTask(taskId: String) = SecuredAction.async { implicit request =>
    for {
      task <- TaskDAO.findOneById(taskId) ?~> Messages("task.notFound")
      _ <- ensureTeamAdministration(request.identity, task.team)
      annotations <- task.annotations
      jsons <- Fox.serialSequence(annotations)(_.toJson(Some(request.identity)))
    } yield {
      Ok(JsArray(jsons.flatten))
    }
  }


  def cancel(typ: String, id: String) = SecuredAction.async { implicit request =>
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
      annotation <- annotation.muta.transferToUser(user)
      restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
      json <- annotation.toJson(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json)
    }
  }

  def duplicate(typ: String, id: String) = SecuredAction.async { implicit request =>
    withAnnotation(AnnotationIdentifier(typ, id)) { annotation =>
      for {
        newAnnotation <- duplicateAnnotation(annotation, request.identity)
        restrictions <- restrictionsFor(AnnotationIdentifier(typ, id))
        json <- newAnnotation.toJson(Some(request.identity), Some(restrictions))
      } yield {
        JsonOk(json)
      }
    }(securedRequestToUserAwareRequest)
  }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      dataSet <- DataSetDAO.findOneBySourceName(
        annotation.dataSetName).toFox ?~> Messages("dataSet.notFound", annotation.dataSetName)
      oldTracingReference = annotation.tracingReference
      dataSource <- dataSet.dataSource.toUsable ?~> "DataSet is not imported."
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(oldTracingReference) ?~> "Failed to create skeleton tracing."
      clonedAnnotation <- AnnotationService.createFrom(
        user, dataSet, newTracingReference, AnnotationType.Explorational, annotation.settings, None, annotation.description) ?~> Messages("annotation.create.failed")
    } yield clonedAnnotation
  }
}
