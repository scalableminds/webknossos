/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.annotation

import com.scalableminds.webknossos.datastore.tracings.TracingType
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{BoxImplicits, Fox, FoxImplicits}
import models.task.TaskAssignmentService
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import models.annotation.AnnotationState._

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
      if (annotation.state == Active)
        executeFinish(annotation)
      else
        Fox.failure("annotation.notActive")
    } else {
      Fox.failure("annotation.notPossible")
    }
  }

  def reopen()(implicit ctx: DBAccessContext) = {
    AnnotationDAO.updateState(annotation._id, AnnotationState.Active)
  }

  def rename(name: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.rename(annotation._id, name)

  def setDescription(description: String)(implicit ctx: DBAccessContext) =
    AnnotationDAO.setDescription(annotation._id, description)

  def setIsPublic(isPublic: Boolean)(implicit ctx: DBAccessContext) =
    AnnotationDAO.setIsPublic(annotation._id, isPublic)

  def setTags(tags: List[String])(implicit ctx: DBAccessContext) =
    AnnotationDAO.setTags(annotation._id, tags)

  def cancelTask()(implicit ctx: DBAccessContext) =
    for {
      task <- annotation.task
      _ <- TaskAssignmentService.putBackInstance(task)
      _ <- AnnotationDAO.updateState(annotation, Cancelled)
    } yield annotation

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
