package models.task

import models.annotation.{AnnotationService, Annotation, AnnotationType, AnnotationDAO}
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID

import braingames.util.FoxImplicits
import play.api.libs.concurrent.Execution.Implicits._
import models.user.Experience
import scala.concurrent.Future

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:59
 */
object TaskService extends TaskAssignmentSimulation with TaskAssignment with FoxImplicits {
  def findAllTrainings(implicit ctx: DBAccessContext) = TaskDAO.findAllTrainings

  def findAllAssignableNonTrainings(implicit ctx: DBAccessContext) = TaskDAO.findAllAssignableNonTrainings

  def findAllNonTrainings(implicit ctx: DBAccessContext) = TaskDAO.findAllNonTrainings

  def remove(_task: BSONObjectID)(implicit ctx: DBAccessContext) = {
    AnnotationDAO.removeAllWithTaskId(_task)
    TaskDAO.removeById(_task)
  }

  def toTrainingForm(t: Task): Option[(String, Training)] =
    Some((t.id, (t.training getOrElse Training.empty)))

  def fromTrainingForm(taskId: String, training: Training)(implicit ctx: DBAccessContext) =
    for {
      task <- TaskDAO.findOneById(taskId).toFox
    } yield {
      task.copy(training = Some(training))
    }

  def assignOnce(t: Task)(implicit ctx: DBAccessContext) =
    TaskDAO.assignOnce(t._id)

  def unassignOnce(t: Task)(implicit ctx: DBAccessContext) =
    TaskDAO.unassignOnce(t._id)

  def setTraining(trainingsTask: Task, training: Training, sample: Annotation)(implicit ctx: DBAccessContext) = {
    TaskDAO.setTraining(trainingsTask._id, training.copy(sample = sample._id))
  }

  def logTime(time: Long, task: Task)(implicit ctx: DBAccessContext) = {
    TaskDAO.logTime(time, task._id)
  }

  def copyDeepAndInsert(source: Task, includeUserTracings: Boolean = true)(implicit ctx: DBAccessContext) = {
    val task = source.copy(_id = BSONObjectID.generate)

    def copy(annotations: List[Annotation]) = Future.traverse(annotations) { annotation =>
      if (includeUserTracings || AnnotationType.isSystemTracing(annotation))
        AnnotationService.copyDeepAndInsert(annotation.copy(_task = Some(task._id)))
      else
        Future.successful(None)
    }

    for {
      _ <- TaskDAO.insert(task)
      annotations <- AnnotationDAO.findByTaskId(source._id)
      _ <- copy(annotations)
    } yield {
      task
    }
  }
}
