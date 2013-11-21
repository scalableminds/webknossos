package models.task

import models.user.User
import models.annotation.{AnnotationType, AnnotationDAO, AnnotationService}
import org.bson.types.ObjectId
import scala.concurrent.Future
import braingames.util.FoxImplicits
import reactivemongo.bson.BSONObjectID
import scala.async.Async._
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:57
 */
trait TaskAssignmentSimulation extends TaskAssignment with FoxImplicits {

  case class AssignmentStatus(assignments: Map[User, Task], tasks: Map[BSONObjectID, Task]) {
    def addAssignment(user: User, task: Task, isTraining: Boolean) = {
      if (isTraining)
        this.copy(assignments = assignments + (user -> task))
      else
        this.copy(
          assignments = assignments + (user -> task),
          tasks = tasks + (task._id -> task.copy(assignedInstances = task.assignedInstances + 1))
        )
    }
  }

  object AssignmentStatus {
    def apply(availableTasks: List[Task]): AssignmentStatus = {
      val tasks = availableTasks.map(t => t._id -> t).toMap
      AssignmentStatus(Map.empty, tasks)
    }
  }

  def simulateFinishOfCurrentTask(user: User): Future[User] = {
    AnnotationService.openTasksFor(user).foldLeft(Future.successful(user)) {
      case (u, annotation) =>
        u.flatMap { user =>
          (for {
            task <- annotation.task
            if (task.isTraining)
            training <- task.training.toFox
          } yield {
            user.increaseExperience(training.domain, training.gain)
          }) getOrElse user
        }
    }
  }

  def simulateTaskAssignment(users: List[User])(implicit ctx: DBAccessContext): Future[Map[User, Task]] = {
    def assignToEach(users: List[User], assignmentStatus: AssignmentStatus): Future[AssignmentStatus] = {
      users.foldLeft(Future.successful(assignmentStatus)){
        case (status, user) =>
          async{
            await(simulateTaskAssignments(user, await(status)))
          }
      }
    }
    for {
      preparedUsers <- Future.traverse(users)(simulateFinishOfCurrentTask)
      available <- findAllAssignableNonTrainings
      result <- assignToEach(preparedUsers, AssignmentStatus(available))
    } yield {
      result.assignments
    }
  }

  def simulateTaskAssignments(user: User, assignmentStatus: AssignmentStatus)(implicit ctx: DBAccessContext): Future[AssignmentStatus] = {
    val doneTasks = AnnotationDAO.findFor(user, AnnotationType.Task).flatMap(_._task)
    val tasksAvailable = assignmentStatus.tasks.values.filter(t =>
      t.hasEnoughExperience(user) && !doneTasks.contains(t._id) && !t.isFullyAssigned)
    async {
      await(nextTaskForUser(user, Future.successful(tasksAvailable.toList))) match {
        case Some(task) =>
          assignmentStatus.addAssignment(user, task, false)
        case _ =>
          await(Training.findAssignableFor(user)).headOption match {
            case Some(training) =>
              assignmentStatus.addAssignment(user, training, true)
            case _ =>
              assignmentStatus
          }
      }
    }
  }
}

