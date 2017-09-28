package models.annotation

import com.scalableminds.util.io.NamedStream
import com.scalableminds.util.mvc.BoxImplicits
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.project.{Project, WebknossosAssignmentConfig}
import models.task.{OpenAssignmentService, Task}
import models.tracing.skeleton.SkeletonTracing
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.{JsValue, Json}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 21.01.14
 * Time: 14:06
 */
trait AnnotationMutationsLike {

  type AType <: AnnotationLike

  def resetToBase()(implicit ctx: DBAccessContext): Fox[AType]

  def reopen()(implicit ctx: DBAccessContext): Fox[AType]

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext): Fox[AType]

  def cancelTask()(implicit ctx: DBAccessContext): Fox[AType]

  def loadAnnotationContent()(implicit ctx: DBAccessContext): Fox[NamedStream]
}

class AnnotationMutations(val annotation: Annotation)
  extends AnnotationMutationsLike
  with AnnotationFileService
  with AnnotationContentProviders
  with BoxImplicits
  with FoxImplicits {

  type AType = Annotation

  def finishAnnotation(user: User)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
    def executeFinish(annotation: Annotation): Fox[(Annotation, String)] = {
      for {
        updated <- AnnotationService.finish(annotation)
      } yield {
        if (annotation._task.isEmpty)
          updated -> "annotation.finished"
        else
          updated -> "task.finished"
      }
    }

    if (annotation.restrictions.allowFinish(user)) {
      if (annotation.state.isInProgress)
        executeFinish(annotation)
      else
          Fox.failure("annotation.notInProgress")
    } else {
      Fox.failure("annotation.notPossible")
    }
  }

  def reopen()(implicit ctx: DBAccessContext) = {
    AnnotationDAO.reopen(annotation._id)
  }

  def update(field: String, value: JsValue)(implicit ctx: DBAccessContext) =
    AnnotationDAO.update(Json.obj("_id" -> annotation._id), Json.obj(field -> value))

  def rename(name: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.rename(annotation._id, name)

  def setDescription(description: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.setDescription(annotation._id, description)

  def setIsPublic(isPublic: Boolean)(implicit ctx: DBAccessContext) =
    AnnotationDAO.setIsPublic(annotation._id, isPublic)

  def setTags(tags: List[String])(implicit ctx: DBAccessContext) =
    AnnotationDAO.setTags(annotation._id, tags)

  def cancelTask()(implicit ctx: DBAccessContext) = {
    def insertReplacement(task: Task, project: Project) = {
      project.assignmentConfiguration match {
        case WebknossosAssignmentConfig =>
          OpenAssignmentService.insertOneFor(task, project)
        case _ =>
          // If this is a project with its assignments on MTurk, they will handle the replacement generation
          Fox.successful(true)
      }
    }

    for {
      task <- annotation.task
      project <- task.project
      _ <- insertReplacement(task, project)
      _ <- AnnotationDAO.updateState(annotation, AnnotationState.Unassigned)
    } yield annotation
  }

  def incrementVersion()(implicit ctx: DBAccessContext) =
    AnnotationDAO.incrementVersion(annotation._id)

  def resetToBase()(implicit ctx: DBAccessContext) = {
    def resetContent(): Fox[AnnotationContent] ={
      annotation.typ match {
        case AnnotationType.Explorational =>
          Fox.failure("annotation.revert.skeletonOnly")
        case AnnotationType.Task if annotation.contentType == SkeletonTracing.contentType =>
          for {
            task <- annotation.task.toFox
            tracingBase <- task.annotationBase.flatMap(_.content)
            reset <- tracingBase.temporaryDuplicate(id = BSONObjectID.generate.stringify).flatMap(_.saveToDB)
          } yield reset
        case _ if annotation.contentType != SkeletonTracing.contentType =>
          Fox.failure("annotation.revert.skeletonOnly")
      }
    }

    for {
      oldAnnotationContent <- annotation.content
      reset <- resetContent()
      _ <- oldAnnotationContent.service.clearAndRemove(oldAnnotationContent.id)
      updatedAnnotation <- AnnotationDAO.updateContent(annotation._id, ContentReference.createFor(reset))
    } yield updatedAnnotation
  }

  def updateFromJson(js: Seq[JsValue])(implicit ctx: DBAccessContext) = {
    annotation.content.flatMap(_.updateFromJson(js)).flatMap(_ =>
      AnnotationDAO.incrementVersion(annotation._id))
  }

  def transferToUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      updatedAnnotation <- AnnotationDAO.transfer(annotation._id, user._id)
    } yield updatedAnnotation
  }
}
