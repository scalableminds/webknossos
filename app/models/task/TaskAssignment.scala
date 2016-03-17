package models.task


import scala.concurrent.{ExecutionContext, Future}

import models.annotation.AnnotationService
import play.api.Play._
import models.user.{UserService, User}
import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{FoxImplicits, Fox}
import play.api.libs.iteratee._
import play.api.libs.concurrent.Execution.Implicits.{ defaultContext => dec }

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:57
 */
trait TaskAssignment extends FoxImplicits{

  def findNextAssignment(implicit ctx: DBAccessContext): Enumerator[OpenAssignment]

  val conf = current.configuration

  /**
   * Create an Enumeratee that filters the inputs using the given predicate
   *
   * @param predicate A function to filter the input elements.
   * $paramEcSingle
   */
  def filterM[U](predicate: U => Future[Boolean])(implicit ec: ExecutionContext): Enumeratee[U, U] = new Enumeratee.CheckDone[U, U] {
    def step[A](k: K[U, A]): K[U, Iteratee[U, A]] = {

      case in @ Input.El(e) => Iteratee.flatten(predicate(e).map { b =>
        if (b) new Enumeratee.CheckDone[U, U] {def continue[A](k: K[U, A]) = Cont(step(k))} &> k(in)
        else Cont(step(k))
      }(dec))

      case in @ Input.Empty =>
        new Enumeratee.CheckDone[U, U] {def continue[A](k: K[U, A]) = Cont(step(k))} &> k(in)

      case Input.EOF => Done(Cont(k), Input.EOF)

    }

    def continue[A](k: K[U, A]) = Cont(step(k))
  }

  private def findAssignable(user: User)(implicit ctx: DBAccessContext) = {
    val experienceFilter = Enumeratee.filter[OpenAssignment] { assignment =>
      assignment.hasEnoughExperience(user)
    }

    val alreadyDoneFilter = filterM[OpenAssignment]{ assignment =>
      AnnotationService.findTaskOf(user, assignment._task).futureBox.map(_.isEmpty)
    }

    findNextAssignment(ctx) &> experienceFilter ><> alreadyDoneFilter
  }

  def findAllAssignableFor(user: User)(implicit ctx: DBAccessContext): Fox[List[OpenAssignment]] = {
    findAssignable(user) |>>> Iteratee.getChunks[OpenAssignment]
  }

  def findAssignableFor(user: User)(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    findAssignable(user) |>>> Iteratee.head[OpenAssignment]
  }

  def allNextTasksForUser(user: User)(implicit ctx: DBAccessContext): Fox[List[Task]] =
    findAllAssignableFor(user).flatMap(assignments => Fox.sequenceOfFulls(assignments.map(_.task)))

  def nextTaskForUser(user: User)(implicit ctx: DBAccessContext): Fox[Task] =
    findAssignableFor(user).flatMap(_.task)
}
