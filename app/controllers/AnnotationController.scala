package controllers

import javax.inject.Inject
import akka.util.Timeout
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import models.annotation._
import models.binary.{DataSet, DataSetDAO, DataStoreHandlingStrategy}
import models.task.TaskDAO
import models.user.time._
import models.user.{User, UserDAO}
import oxalis.security.WebknossosSilhouette.{SecuredAction, SecuredRequest, UserAwareAction}
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
      annotation <- provideAnnotation(typ, id) ?~> "annotation.notFound"
      restrictions <- restrictionsFor(typ, id) ?~> "restrictions.notFound"
      _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> BAD_REQUEST
      js <- annotation.publicWrites(request.identity, Some(restrictions), Some(readOnly)) ?~> "could not convert annotation to json"
      _ <- Fox.runOptional(request.identity) { user =>
        if (typ == AnnotationType.Task || typ == AnnotationType.Explorational) {
          TimeSpanService.logUserInteraction(user, annotation) // log time when a user starts working
        } else Fox.successful(())
      }
    } yield {
      Ok(js)
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, readOnly = true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String) = SecuredAction.async { implicit request =>
    for {
      identifierA <- AnnotationIdentifier.parse(typ, id)
      identifierB <- AnnotationIdentifier.parse(mergedTyp, mergedId)
      mergedAnnotation <- AnnotationMerger.mergeTwoByIds(identifierA, identifierB, true)
      restrictions = AnnotationRestrictions.defaultAnnotationRestrictions(mergedAnnotation)
      _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
      _ <- AnnotationDAO.insertOne(mergedAnnotation)
      js <- mergedAnnotation.publicWrites(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(js, Messages("annotation.merge.success"))
    }
  }


  def loggedTime(typ: String, id: String) = SecuredAction.async { implicit request =>
      for {
        annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
        restrictions <- restrictionsFor(typ, id)(securedRequestToUserAwareRequest)
        _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
        loggedTimeAsMap <- TimeSpanService.loggedTimeOfAnnotation(annotation._id, TimeSpan.groupByMonth)
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
      restrictions <- restrictionsFor(typ, id)(securedRequestToUserAwareRequest)
      _ <- restrictions.allowUpdate(request.identity) ?~> Messages("notAllowed")
      _ <- bool2Fox(annotation.isRevertPossible) ?~> Messages("annotation.revert.toOld")
      dataSet <- annotation.dataSet
      dataStoreHandler <- dataSet.dataStoreHandler
      skeletonTracingId <- annotation.skeletonTracingId.toFox
      newSkeletonTracingId <- dataStoreHandler.duplicateSkeletonTracing(skeletonTracingId, Some(version.toString))
      _ <- AnnotationDAO.updateSkeletonTracingId(annotation._id, newSkeletonTracingId)
    } yield {
      logger.info(s"REVERTED [$typ - $id, $version]")
      JsonOk("annotation.reverted")
    }
  }

  def reset(typ: String, id: String) = SecuredAction.async { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      _ <- ensureTeamAdministration(request.identity, annotation._team)
      _ <- annotation.muta.resetToBase ?~> Messages("annotation.reset.failed")
      updated <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      json <- updated.publicWrites(Some(request.identity))
    } yield {
      JsonOk(json, Messages("annotation.reset.success"))
    }
  }

  def reopen(typ: String, id: String) = SecuredAction.async { implicit request =>
    def isReopenAllowed(user: User, annotation: Annotation) = for {
      isAdminOrTeamManager <- user.isTeamManagerOrAdminOf(annotation._team)
    } yield (annotation._user == user._id || isAdminOrTeamManager)

    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      _ <- Fox.assertTrue(isReopenAllowed(request.identity, annotation)) ?~> "reopen.notAllowed"
      _ <- annotation.muta.reopen ?~> "annotation.invalid"
      updatedAnnotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
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
        dataSetSQL <- DataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        tracingType <- TracingType.values.find(_.toString == request.body.typ).toFox
        annotation <- AnnotationService.createExplorationalFor(request.identity, dataSetSQL._id, tracingType, request.body.withFallback.getOrElse(true)) ?~> Messages("annotation.create.failed")
        json <- annotation.publicWrites(Some(request.identity))
      } yield {
        JsonOk(json)
      }
    }

  private def finishAnnotation(typ: String, id: String, user: User)(implicit request: SecuredRequest[_]): Fox[(Annotation, String)] = {
    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      restrictions <- restrictionsFor(typ, id)(securedRequestToUserAwareRequest)
      message <- annotation.muta.finish(user, restrictions)
      updated <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      _ <- TimeSpanService.logUserInteraction(user, annotation) // log time on tracing end
    } yield {
      (updated, message)
    }
  }

  def finish(typ: String, id: String) = SecuredAction.async { implicit request =>
    for {
      (updated, message) <- finishAnnotation(typ, id, request.identity)
      restrictions <- restrictionsFor(typ, id)(securedRequestToUserAwareRequest)
      json <- updated.publicWrites(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json, Messages(message))
    }
  }

  def finishAll(typ: String) = SecuredAction.async(parse.json) { implicit request =>
    withJsonAs[JsArray](request.body \ "annotations") { annotationIds =>
      val results = Fox.serialSequence(annotationIds.value.toList){jsValue =>
        jsValue.asOpt[String].toFox.flatMap(id => finishAnnotation(typ, id, request.identity))
      }

      results.map { results =>
        JsonOk(Messages("annotation.allFinished"))
      }
    }
  }

  def editAnnotation(typ: String, id: String) = SecuredAction.async(parse.json) { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
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
      task <- TaskDAO.findOne(taskIdValidated) ?~> Messages("task.notFound")
      project <- task.project
      _ <- ensureTeamAdministration(request.identity, project._team)
      annotations <- task.annotations
      jsons <- Fox.serialSequence(annotations)(_.publicWrites(Some(request.identity)))
    } yield {
      Ok(JsArray(jsons.flatten))
    }
  }


  def cancel(typ: String, id: String) = SecuredAction.async { implicit request =>
    def tryToCancel(annotation: Annotation) = {
      annotation match {
        case t if t.typ == AnnotationType.Task =>
          annotation.muta.cancel.map { _ =>
            JsonOk(Messages("task.finished"))
          }
        case _                                 =>
          Fox.successful(JsonOk(Messages("annotation.finished")))
      }
    }

    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      _ <- ensureTeamAdministration(request.identity, annotation._team)
      result <- tryToCancel(annotation)
    } yield result
  }

  def transfer(typ: String, id: String) = SecuredAction.async(parse.json) { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      restrictions <- restrictionsFor(typ, id)(securedRequestToUserAwareRequest)
      _ <- restrictions.allowFinish(request.identity) ?~> Messages("notAllowed")
      newUserId <- (request.body \ "userId").asOpt[String].toFox
      newUserIdValidated <- ObjectId.parse(newUserId)
      newUser <- UserDAO.findOne(newUserIdValidated) ?~> Messages("user.notFound")
      _ <- annotation.muta.transferToUser(newUser)
      updated <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      json <- updated.publicWrites(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json)
    }
  }

  def duplicate(typ: String, id: String) = SecuredAction.async { implicit request =>
    for {
      annotation <- provideAnnotation(typ, id)(securedRequestToUserAwareRequest)
      newAnnotation <- duplicateAnnotation(annotation, request.identity)
      restrictions <- restrictionsFor(typ, id)(securedRequestToUserAwareRequest)
      json <- newAnnotation.publicWrites(Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json)
    }
  }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      dataSet: DataSet <- annotation.dataSet
      _ <- bool2Fox(dataSet.isUsable) ?~> "DataSet is not imported."
      dataStoreHandler <- dataSet.dataStoreHandler
      newSkeletonTracingReference <- Fox.runOptional(annotation.skeletonTracingId)(id => dataStoreHandler.duplicateSkeletonTracing(id)) ?~> "Failed to duplicate skeleton tracing."
      newVolumeTracingReference <- Fox.runOptional(annotation.volumeTracingId)(id => dataStoreHandler.duplicateVolumeTracing(id)) ?~> "Failed to duplicate volume tracing."
      clonedAnnotation <- AnnotationService.createFrom(
        user, dataSet, newSkeletonTracingReference, newVolumeTracingReference, AnnotationType.Explorational, None, annotation.description) ?~> Messages("annotation.create.failed")
    } yield clonedAnnotation
  }
}
