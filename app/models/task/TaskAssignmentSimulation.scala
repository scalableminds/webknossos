package models.task

import models.user.User
import models.annotation.{Annotation, AnnotationType, AnnotationDAO, AnnotationService}

import scala.concurrent.Future
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.iteratee.Iteratee
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

  case class AssignmentStatus(assignments: Map[User, Task], usersLeft: List[User]) {
    def addAssignment(user: User, task: Task) = {
      this.copy(
        assignments = assignments + (user -> task)
      )
    }

    def removeUser(user: User) = {
      this.copy(usersLeft = usersLeft.filter(_ != user))
    }
  }

  object AssignmentStatus {
    def empty(users: List[User]): AssignmentStatus = {
      AssignmentStatus(Map.empty, users)
    }
  }

  def firstUserThatCanTakeAssignment(users: List[User], assignment: OpenAssignment)(implicit ctx: DBAccessContext): Future[Option[User]] = {
    users match {
      case first :: tail =>
        if(!assignment.hasEnoughExperience(first))
          firstUserThatCanTakeAssignment(tail, assignment)
        else
          AnnotationService.countTaskOf(first, assignment._task).futureBox.map(_.contains(0)).flatMap{
            case true  => Future.successful(Some(first))
            case false => firstUserThatCanTakeAssignment(tail, assignment)
          }
      case Nil =>
        Future.successful(None)
    }
  }

  def simulateTaskAssignment(users: List[User])(implicit ctx: DBAccessContext): Fox[Map[User, Task]] = {
    val assignmentSimulation = Iteratee.fold2[OpenAssignment, AssignmentStatus](AssignmentStatus.empty(users)){
      case (assignmentStatus, nextOpenAssignment) =>
        async{
          await(firstUserThatCanTakeAssignment(assignmentStatus.usersLeft, nextOpenAssignment)) match {
            case Some(user) =>
              await(nextOpenAssignment.task.futureBox) match {
                case Full(task) =>
                  val updatedStatus = assignmentStatus.addAssignment(user, task).removeUser(user)
                  (updatedStatus, updatedStatus.usersLeft.isEmpty)
                case _ =>
                  (assignmentStatus, false)
              }
            case None =>
              (assignmentStatus, false)
          }
        }
    }

    (findAllAssignments |>>> assignmentSimulation).map(_.assignments)
  }
}

