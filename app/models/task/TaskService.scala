package models.task

import models.annotation.{AnnotationService, Annotation, AnnotationType, AnnotationDAO}
import braingames.reactivemongo.DBAccessContext
import reactivemongo.bson.BSONObjectID

import braingames.util.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import models.user.Experience
import scala.concurrent.Future
import play.api.Logger
import reactivemongo.core.commands.LastError

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
    TaskDAO.removeById(_task).flatMap{
      case result if result.n > 0 =>
        AnnotationDAO.removeAllWithTaskId(_task)
      case _ =>
        Logger.warn("Tried to remove task without permission.")
        Future.successful(LastError(false ,None, None, None, None, 0, false))
    }
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

    def executeCopy(annotations: List[Annotation]) = Fox.sequence(annotations.map{ annotation =>
      if (includeUserTracings || AnnotationType.isSystemTracing(annotation))
        annotation.copy(_task = Some(task._id)).muta.copyDeepAndInsert()
      else
        Fox.empty
    })

    for {
      _ <- TaskDAO.insert(task)
      annotations <- AnnotationDAO.findByTaskId(source._id)
      _ <- executeCopy(annotations)
    } yield {
      task
    }
  }
}
