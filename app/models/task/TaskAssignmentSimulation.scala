package models.task

import models.user.User
import models.annotation.{Annotation, AnnotationType, AnnotationDAO, AnnotationService}

import scala.concurrent.Future
import braingames.util.{Fox, FoxImplicits}
import reactivemongo.bson.BSONObjectID
import scala.async.Async._
import play.api.libs.concurrent.Execution.Implicits._
import braingames.reactivemongo.DBAccessContext
import net.liftweb.common.{Failure, Full}

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

  def simulateFinishOfCurrentTask(user: User)(implicit ctx: DBAccessContext): Fox[User] = {
    def simulateFinishOfAnnotation(userFox: Fox[User], annotation: Annotation): Fox[User] = userFox.flatMap {
      user =>
        val updated =
          for {
            task <- annotation.task
            if (task.isTraining)
            training <- task.training.toFox
          } yield {
            user.increaseExperience(training.domain, training.gain)
          }

        updated getOrElse user
    }


    AnnotationService.openTasksFor(user).flatMap {
      tasks =>
        tasks.foldLeft(Fox.successful(user))(simulateFinishOfAnnotation)
    }
  }

  def simulateTaskAssignment(users: List[User])(implicit ctx: DBAccessContext): Fox[Map[User, Task]] = {
    def assignToEach(users: List[User], assignmentStatus: AssignmentStatus): Fox[AssignmentStatus] = {
      users.foldLeft(Fox.successful(assignmentStatus)) {
        case (status, user) => status.flatMap(simulateTaskAssignments(user, _))
      }
    }

    for {
      preparedUsers <- Fox.combined(users.map(simulateFinishOfCurrentTask))
      available <- findAllAssignableNonTrainings
      result <- assignToEach(preparedUsers, AssignmentStatus(available))
    } yield {
      result.assignments
    }
  }

  def simulateTaskAssignments(user: User, assignmentStatus: AssignmentStatus)(implicit ctx: DBAccessContext): Fox[AssignmentStatus] = {
    async {
      await(AnnotationService.findTasksOf(user).map(_.flatMap(_._task)).futureBox) match {
        case Full(doneTasks) =>

          def canBeDoneByUser(t: Task) = t.hasEnoughExperience(user) && !doneTasks.contains(t._id) && !t.isFullyAssigned

          val tasksAvailable = assignmentStatus.tasks.values.filter(canBeDoneByUser)
          await(nextTaskForUser(user, Future.successful(tasksAvailable.toList)).futureBox) match {
            case Full(task) =>
              Full(assignmentStatus.addAssignment(user, task, false))
            case _ =>
              await(Training.findAssignableFor(user).futureBox) match {
                case Full(training :: _) =>
                  Full(assignmentStatus.addAssignment(user, training, true))
                case _ =>
                  Full(assignmentStatus)
              }
          }

        case f: Failure => f
        case _ => Failure("Failed to simulate task assignemtns")

      }
    }
  }
}

