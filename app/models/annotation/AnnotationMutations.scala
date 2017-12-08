package models.annotation

import com.scalableminds.braingames.datastore.tracings.TracingType
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import models.project.{Project, WebknossosAssignmentConfig}
import models.task.{OpenAssignmentService, Task}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import models.annotation.AnnotationState._

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 21.01.14
 * Time: 14:06
 */

class AnnotationMutations(val annotation: Annotation) extends BoxImplicits with FoxImplicits {

  type AType = Annotation

  def finishAnnotation(user: User, restrictions: AnnotationRestrictions)(implicit ctx: DBAccessContext): Fox[(Annotation, String)] = {
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

    if (restrictions.allowFinish(user)) {
      if (annotation.state == InProgress)
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
      _ <- AnnotationDAO.updateState(annotation, Unassigned)
    } yield annotation
  }

  def resetToBase()(implicit ctx: DBAccessContext): Fox[Annotation] = annotation.typ match {
    case AnnotationType.Explorational =>
      Fox.failure("annotation.revert.skeletonOnly")
    case AnnotationType.Task if annotation.tracingType == TracingType.skeleton =>
      for {
        task <- annotation.task.toFox
        annotationBase <- task.annotationBase
        newTracingReference <- AnnotationService.tracingFromBase(annotationBase)
        updatedAnnotation <- AnnotationDAO.updateTracingRefernce(annotation._id, newTracingReference)
      } yield {
        updatedAnnotation
      }
    case _ if annotation.tracingType != TracingType.skeleton =>
      Fox.failure("annotation.revert.skeletonOnly")
  }

  def transferToUser(user: User)(implicit ctx: DBAccessContext) = {
    for {
      updatedAnnotation <- AnnotationDAO.transfer(annotation._id, user._id)
    } yield updatedAnnotation
  }
}
