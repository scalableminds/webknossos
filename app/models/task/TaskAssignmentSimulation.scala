package models.task

import models.user.User
import models.annotation.{Annotation, AnnotationType, AnnotationDAO, AnnotationService}

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

  def simulateFinishOfCurrentTask(user: User)(implicit ctx: DBAccessContext): Future[User] = {
    def simulateFinishOfAnnotation(userFuture: Future[User], annotation: Annotation): Future[User] = async {
      val user = await(userFuture)
      val updated =
        for {
          task <- annotation.task
          if (task.isTraining)
          training <- task.training.toFox
        } yield {
          user.increaseExperience(training.domain, training.gain)
        }

      await(updated getOrElse user)
    }


    AnnotationService.openTasksFor(user).flatMap { tasks =>
      tasks.foldLeft(Future.successful(user))(simulateFinishOfAnnotation)
    }
  }

  def simulateTaskAssignment(users: List[User])(implicit ctx: DBAccessContext): Future[Map[User, Task]] = {
    def assignToEach(users: List[User], assignmentStatus: AssignmentStatus): Future[AssignmentStatus] = {
      users.foldLeft(Future.successful(assignmentStatus)) {
        case (status, user) =>
          async {
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
    async {
      val doneTasks = await(AnnotationService.findTasksOf(user).map(_.flatMap(_._task)))

      def canBeDoneByUser(t: Task) = t.hasEnoughExperience(user) && !doneTasks.contains(t._id) && !t.isFullyAssigned

      val tasksAvailable = assignmentStatus.tasks.values.filter(canBeDoneByUser)
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

