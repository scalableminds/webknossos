package controllers

import javax.inject.Inject
import akka.util.Timeout
import com.scalableminds.util.reactivemongo.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import models.annotation.{Annotation, _}
import models.binary.{DataSetDAO, DataSetSQLDAO}
import models.task.TaskSQLDAO
import models.user.time._
import models.user.{User, UserDAO}
import oxalis.security.WebknossosSilhouette.{SecuredAction, UserAwareAction}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{JsArray, _}
import utils.ObjectId

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._


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

  def info(typ: String, id: String, readOnly: Boolean = false) = UserAwareAction.async { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)
      restrictions <- restrictionsFor(typ, id)
      _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> BAD_REQUEST
      js <- annotation.publicWrites(request.identity, Some(restrictions), Some(readOnly))
    } yield {
      request.identity.foreach { user =>
        TimeSpanService.logUserInteraction(user, annotation) // log time when a user starts working
      }
      Ok(js)
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, readOnly = true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String) = SecuredAction.async { implicit request =>
    for {
      mergedAnnotation <- AnnotationMerger.mergeTwoByIds(id, typ, mergedId, mergedTyp, true)
      restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(mergedAnnotation)
      _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
      _ <- AnnotationSQLDAO.insertOne(mergedAnnotation)
      js <- mergedAnnotation.publicWrites(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(js, Messages("annotation.merge.success"))
    }
  }


  def loggedTime(typ: String, id: String) = SecuredAction.async { implicit request =>
      for {
        annotation <- provideAnnotation(typ, id) //TODO: (securedRequestToUserAwareRequest)
        restrictions <- restrictionsFor(typ, id)
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
  }

  def revert(typ: String, id: String, version: Int) = SecuredAction.async { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      restrictions <- restrictionsFor(typ, id)
      _ <- restrictions.allowUpdate(request.identity) ?~> Messages("notAllowed")
      _ <- annotation.isRevertPossible ?~> Messages("annotation.revert.toOld")
      dataSet <- DataSetDAO.findOneById(annotation._dataSet).toFox ?~> Messages("dataSet.notFound", annotation._dataSet)
      newTracingReference <- dataSet.dataStore.duplicateSkeletonTracing(annotation.tracing, Some(version.toString))
      _ <- AnnotationSQLDAO.updateTracingReference(annotation._id, newTracingReference)
    } yield {
      logger.info(s"REVERTED [$typ - $id, $version]")
      JsonOk("annotation.reverted")
    }
  }

  def reset(typ: String, id: String) = SecuredAction.async { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)
      _ <- ensureTeamAdministration(request.identity, annotation._team)
      reset <- annotation.muta.resetToBase() ?~> Messages("annotation.reset.failed")
      json <- reset.toJson(Some(request.identity))
    } yield {
      JsonOk(json, Messages("annotation.reset.success"))
    }
  }

  def reopen(typ: String, id: String) = SecuredAction.async { implicit request =>
    def isReopenAllowed(user: User, annotation: AnnotationSQL) = for {
      teamIdBson <- annotation._team.toBSONObjectId.toFox
      isAdminOrTeamManager <- user.isTeamManagerOrAdminOf(teamIdBson)
    } yield (annotation._user == user._id || isAdminOrTeamManager)

    for {
      annotation <- provideAnnotation(typ, id)
      isAllowed <- isReopenAllowed(request.identity, annotation)
      _ <- isAllowed ?~> "reopen.notAllowed"
      _ <- annotation.muta.reopen ?~> "annotation.invalid"
      updatedAnnotation <- provideAnnotation(typ, id)
      json <- updatedAnnotation.publicWrites(Some(request.identity))
    } yield {
      JsonOk(json, Messages("annotation.reopened"))
    }
  }


  case class CreateExplorationalParameters(typ: String, withFallback: Option[Boolean])
  object CreateExplorationalParameters {implicit val jsonFormat = Json.format[CreateExplorationalParameters]}

  def createExplorational(dataSetName: String) =
    SecuredAction.async(validateJson[CreateExplorationalParameters]) { implicit request =>
      for {
        dataSetSQL <- DataSetSQLDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        tracingType <- TracingType.values.find(_.toString == request.body.typ).toFox
        annotation <- AnnotationService.createExplorationalFor(request.identity, dataSetSQL._id, tracingType, request.body.withFallback.getOrElse(true)) ?~> Messages("annotation.create.failed")
        json <- annotation.publicWrites(Some(request.identity))
      } yield {
        JsonOk(json)
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
      taskIdValidated <- ObjectId.parse(taskId)
      task <- TaskSQLDAO.findOne(taskIdValidated) ?~> Messages("task.notFound")
      project <- task.project
      _ <- ensureTeamAdministration(request.identity, project._team)
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
        _ <- ensureTeamAdministration(request.identity, annotation._team)
        result <- tryToCancel(annotation)
      } yield result
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
