package controllers

import javax.inject.Inject
import akka.util.Timeout
import com.scalableminds.util.accesscontext.{DBAccessContext, GlobalAccessContext}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.webknossos.datastore.tracings.TracingType
import models.annotation.AnnotationState.Cancelled
import models.annotation._
import models.binary.{DataSet, DataSetDAO, DataSetService}
import models.project.ProjectDAO
import models.task.TaskDAO
import models.user.time._
import models.user.{User, UserService}
import oxalis.security.WkEnv
import com.mohiva.play.silhouette.api.Silhouette
import com.mohiva.play.silhouette.api.actions.{SecuredRequest, UserAwareRequest}
import play.api.i18n.{Messages, MessagesApi}
import play.api.libs.json.{JsArray, _}
import utils.{ObjectId, WkConf}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.duration._


class AnnotationController @Inject()(annotationDAO: AnnotationDAO,
                                     taskDAO: TaskDAO,
                                     dataSetDAO: DataSetDAO,
                                     dataSetService: DataSetService,
                                     annotationService: AnnotationService,
                                     userService: UserService,
                                     projectDAO: ProjectDAO,
                                     timeSpanService: TimeSpanService,
                                     annotationMerger: AnnotationMerger,
                                     provider: AnnotationInformationProvider,
                                     annotationRestrictionDefults: AnnotationRestrictionDefults,
                                     conf: WkConf,
                                     sil: Silhouette[WkEnv],
                                     val messagesApi: MessagesApi
                                    )
  extends Controller
    with FoxImplicits {

  implicit def userAwareRequestToDBAccess(implicit request: UserAwareRequest[WkEnv, _]) = DBAccessContext(request.identity)
  implicit def securedRequestToDBAccess(implicit request: SecuredRequest[WkEnv, _]) = DBAccessContext(Some(request.identity))

  implicit val timeout = Timeout(5 seconds)

  def empty(typ: String, id: String) = sil.SecuredAction { implicit request =>
    Ok(views.html.main(conf))
  }

  def emptyReadOnly(typ: String, id: String) = sil.UserAwareAction { implicit request =>
    Ok(views.html.main(conf))
  }

  def info(typ: String, id: String, readOnly: Boolean = false) = sil.UserAwareAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound"
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      _ <- restrictions.allowAccess(request.identity) ?~> "notAllowed" ~> BAD_REQUEST
      js <- annotationService.publicWrites(annotation, request.identity, Some(restrictions), Some(readOnly)) ?~> "annotation.write.failed"
      _ <- Fox.runOptional(request.identity) { user =>
        if (typ == AnnotationType.Task || typ == AnnotationType.Explorational) {
          timeSpanService.logUserInteraction(user, annotation) // log time when a user starts working
        } else Fox.successful(())
      }
    } yield {
      Ok(js)
    }
  }

  def infoReadOnly(typ: String, id: String) = info(typ, id, readOnly = true)

  def merge(typ: String, id: String, mergedTyp: String, mergedId: String) = sil.SecuredAction.async { implicit request =>
    for {
      annotationA <- provider.provideAnnotation(typ, id, request.identity)
      annotationB <- provider.provideAnnotation(mergedTyp, mergedId, request.identity)
      mergedAnnotation <- annotationMerger.mergeTwo(annotationA, annotationB, true, request.identity) ?~> "annotation.merge.failed"
      restrictions = annotationRestrictionDefults.defaultAnnotationRestrictions(mergedAnnotation)
      _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
      _ <- annotationDAO.insertOne(mergedAnnotation)
      js <- annotationService.publicWrites(mergedAnnotation, Some(request.identity), Some(restrictions)) ?~> "annotation.write.failed"
    } yield {
      JsonOk(js, Messages("annotation.merge.success"))
    }
  }


  def loggedTime(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
      for {
        annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound"
        restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
        _ <- restrictions.allowAccess(request.identity) ?~> Messages("notAllowed") ~> BAD_REQUEST
        loggedTimeAsMap <- timeSpanService.loggedTimeOfAnnotation(annotation._id, TimeSpan.groupByMonth) ?~> "annotation.timelogging.read.failed"
      } yield {
        Ok(Json.arr(
          loggedTimeAsMap.map {
            case (month, duration) =>
              Json.obj("interval" -> month, "durationInSeconds" -> duration.toSeconds)
          }
        ))
      }
  }

  def revert(typ: String, id: String, version: Int) = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound"
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      _ <- restrictions.allowUpdate(request.identity) ?~> Messages("notAllowed")
      _ <- bool2Fox(annotation.isRevertPossible) ?~> Messages("annotation.revert.toOld")
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
      dataStoreHandler <- dataSetService.handlerFor(dataSet)
      skeletonTracingId <- annotation.skeletonTracingId.toFox ?~> "annotation.noSkeleton"
      newSkeletonTracingId <- dataStoreHandler.duplicateSkeletonTracing(skeletonTracingId, Some(version.toString))
      _ <- annotationDAO.updateSkeletonTracingId(annotation._id, newSkeletonTracingId)
    } yield {
      logger.info(s"REVERTED [$typ - $id, $version]")
      JsonOk("annotation.reverted")
    }
  }

  def reset(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, annotation._team))
      _ <- annotationService.resetToBase(annotation) ?~> Messages("annotation.reset.failed")
      updated <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity))
    } yield {
      JsonOk(json, Messages("annotation.reset.success"))
    }
  }

  def reopen(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
    def isReopenAllowed(user: User, annotation: Annotation) = for {
      isAdminOrTeamManager <- userService.isTeamManagerOrAdminOf(user, annotation._team)
    } yield (annotation._user == user._id || isAdminOrTeamManager)

    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      _ <- Fox.assertTrue(isReopenAllowed(request.identity, annotation)) ?~> "reopen.notAllowed"
      _ <- annotationDAO.updateState(annotation._id, AnnotationState.Active) ?~> "annotation.invalid"
      updatedAnnotation <- provider.provideAnnotation(typ, id, request.identity)
      json <- annotationService.publicWrites(updatedAnnotation, Some(request.identity)) ?~> "annotation.write.failed"
    } yield {
      JsonOk(json, Messages("annotation.reopened"))
    }
  }

  case class CreateExplorationalParameters(typ: String, withFallback: Option[Boolean])
  object CreateExplorationalParameters {implicit val jsonFormat = Json.format[CreateExplorationalParameters]}

  def createExplorational(dataSetName: String) =
    sil.SecuredAction.async(validateJson[CreateExplorationalParameters]) { implicit request =>
      for {
        dataSetSQL <- dataSetDAO.findOneByName(dataSetName) ?~> Messages("dataSet.notFound", dataSetName)
        tracingType <- TracingType.values.find(_.toString == request.body.typ).toFox
        annotation <- annotationService.createExplorationalFor(request.identity, dataSetSQL._id, tracingType, request.body.withFallback.getOrElse(true)) ?~> "annotation.create.failed"
        json <- annotationService.publicWrites(annotation, Some(request.identity)) ?~> "annotation.write.failed"
      } yield {
        JsonOk(json)
      }
    }

  private def finishAnnotation(typ: String, id: String, issuingUser: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    for {
      annotation <- provider.provideAnnotation(typ, id, issuingUser) ?~> "annotation.notFound"
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      message <- annotationService.finish(annotation, issuingUser, restrictions) ?~> "annotation.finish.failed"
      updated <- provider.provideAnnotation(typ, id, issuingUser)
      _ <- timeSpanService.logUserInteraction(issuingUser, annotation) // log time on tracing end
    } yield {
      (updated, message)
    }
  }

  def finish(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
    for {
      (updated, message) <- finishAnnotation(typ, id, request.identity) ?~> "annotation.finish.failed"
      restrictions <- provider.restrictionsFor(typ, id)
      json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json, Messages(message))
    }
  }

  def finishAll(typ: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    withJsonAs[JsArray](request.body \ "annotations") { annotationIds =>
      val results = Fox.serialSequence(annotationIds.value.toList){jsValue =>
        jsValue.asOpt[String].toFox.flatMap(id => finishAnnotation(typ, id, request.identity))
      }

      results.map { results =>
        JsonOk(Messages("annotation.allFinished"))
      }
    }
  }

  def editAnnotation(typ: String, id: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound"
      name = (request.body \ "name").asOpt[String]
      description = (request.body \ "description").asOpt[String]
      isPublic = (request.body \ "isPublic").asOpt[Boolean]
      tags = (request.body \ "tags").asOpt[List[String]]
      _ <- Fox.runOptional(name)(annotationDAO.updateName(annotation._id, _)) ?~> "annotation.edit.failed"
      _ <- Fox.runOptional(description)(annotationDAO.updateDescription(annotation._id, _)) ?~> "annotation.edit.failed"
      _ <- Fox.runOptional(isPublic)(annotationDAO.updateIsPublic(annotation._id, _)) ?~> "annotation.edit.failed"
      _ <- Fox.runOptional(tags)(annotationDAO.updateTags(annotation._id, _)) ?~> "annotation.edit.failed"
    } yield {
      JsonOk(Messages("annotation.edit.success"))
    }
  }

  def annotationsForTask(taskId: String) = sil.SecuredAction.async { implicit request =>
    for {
      taskIdValidated <- ObjectId.parse(taskId)
      task <- taskDAO.findOne(taskIdValidated) ?~> "task.notFound"
      project <- projectDAO.findOne(task._project)
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, project._team))
      annotations <- annotationService.annotationsFor(task._id) ?~> "task.annotation.failed"
      jsons <- Fox.serialSequence(annotations)(a => annotationService.publicWrites(a, Some(request.identity)))
    } yield {
      Ok(JsArray(jsons.flatten))
    }
  }


  def cancel(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
    def tryToCancel(annotation: Annotation) = {
      annotation match {
        case t if t.typ == AnnotationType.Task =>
          annotationDAO.updateState(annotation._id, Cancelled).map { _ =>
            JsonOk(Messages("task.finished"))
          }
        case _ =>
          Fox.successful(JsonOk(Messages("annotation.finished")))
      }
    }

    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity) ?~> "annotation.notFound"
      _ <- Fox.assertTrue(userService.isTeamManagerOrAdminOf(request.identity, annotation._team))
      result <- tryToCancel(annotation)
    } yield result
  }

  def transfer(typ: String, id: String) = sil.SecuredAction.async(parse.json) { implicit request =>
    for {
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      _ <- restrictions.allowFinish(request.identity) ?~> "notAllowed"
      newUserId <- (request.body \ "userId").asOpt[String].toFox ?~> "user.id.notFound"
      newUserIdValidated <- ObjectId.parse(newUserId)
      updated <- annotationService.transferAnnotationToUser(typ, id, newUserIdValidated, request.identity)
      json <- annotationService.publicWrites(updated, Some(request.identity), Some(restrictions))
    } yield {
      JsonOk(json)
    }
  }

  def duplicate(typ: String, id: String) = sil.SecuredAction.async { implicit request =>
    for {
      annotation <- provider.provideAnnotation(typ, id, request.identity)
      newAnnotation <- duplicateAnnotation(annotation, request.identity)
      restrictions <- provider.restrictionsFor(typ, id) ?~> "restrictions.notFound"
      json <- annotationService.publicWrites(newAnnotation, Some(request.identity), Some(restrictions)) ?~> "annotation.write.failed"
    } yield {
      JsonOk(json)
    }
  }

  private def duplicateAnnotation(annotation: Annotation, user: User)(implicit ctx: DBAccessContext): Fox[Annotation] = {
    for {
      dataSet <- dataSetDAO.findOne(annotation._dataSet)(GlobalAccessContext) ?~> "dataSet.notFound"
      _ <- bool2Fox(dataSet.isUsable) ?~> Messages("dataSet.notImported", dataSet.name)
      dataStoreHandler <- dataSetService.handlerFor(dataSet)
      newSkeletonTracingReference <- Fox.runOptional(annotation.skeletonTracingId)(id => dataStoreHandler.duplicateSkeletonTracing(id)) ?~> "Failed to duplicate skeleton tracing."
      newVolumeTracingReference <- Fox.runOptional(annotation.volumeTracingId)(id => dataStoreHandler.duplicateVolumeTracing(id)) ?~> "Failed to duplicate volume tracing."
      clonedAnnotation <- annotationService.createFrom(
        user, dataSet, newSkeletonTracingReference, newVolumeTracingReference, AnnotationType.Explorational, None, annotation.description) ?~> Messages("annotation.create.failed")
    } yield clonedAnnotation
  }
}
