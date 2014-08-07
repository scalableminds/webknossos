package models.task

import models.user.User
import models.annotation.{Annotation, AnnotationType, AnnotationDAO, AnnotationService}

import scala.concurrent.Future
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import reactivemongo.bson.BSONObjectID
import scala.async.Async._
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.DBAccessContext
import net.liftweb.common.{Failure, Full}

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:57
 */
trait TaskAssignmentSimulation extends TaskAssignment with FoxImplicits {

  case class AssignmentStatus(assignments: Map[User, Task], tasks: Map[BSONObjectID, Task]) {
    def addAssignment(user: User, task: Task) = {
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

  def simulateTaskAssignment(users: List[User])(implicit ctx: DBAccessContext): Fox[Map[User, Task]] = {
    def assignToEach(users: List[User], assignmentStatus: AssignmentStatus): Fox[AssignmentStatus] = {
      users.foldLeft(Fox.successful(assignmentStatus)) {
        case (status, user) => status.flatMap(simulateTaskAssignments(user, _))
      }
    }

    for {
      available <- findAllAssignable
      result <- assignToEach(users, AssignmentStatus(available))
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
              Full(assignmentStatus.addAssignment(user, task))
            case _ =>
              Full(assignmentStatus)
          }

        case f: Failure => f
        case _ => Failure("Failed to simulate task assignemtns")
      }
    }
  }
}

