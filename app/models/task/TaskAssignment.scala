package models.task


import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.annotation.AnnotationService
import models.user.User
import play.api.Play._
import play.api.libs.concurrent.Execution.Implicits.{defaultContext => dec}
import play.api.libs.iteratee.Enumeratee.CheckDone
import play.api.libs.iteratee._

import scala.concurrent.{ExecutionContext, Future}
import play.api.libs.iteratee._
import reactivemongo.bson.BSONObjectID

import scala.collection.mutable
import scala.collection.mutable.HashSet

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 19.11.13
 * Time: 14:57
 */
trait TaskAssignment extends FoxImplicits with LazyLogging{

  def findNextAssignment(user: User, teams: List[String])(implicit ctx: DBAccessContext): Enumerator[OpenAssignment]

  def findAllAssignments(implicit ctx: DBAccessContext): Enumerator[OpenAssignment]

  val conf = current.configuration

  /**
    * Create an Enumeratee that filters the inputs using the given predicate
    *
    * @param predicate A function to filter the input elements.
    * $paramEcSingle
    */
  def filterM[E](predicate: E => Future[Boolean])(implicit ec: ExecutionContext): Enumeratee[E, E] = new CheckDone[E, E] {
    val pec = ec.prepare()

    def step[A](k: K[E, A]): K[E, Iteratee[E, A]] = {

      case in @ Input.El(e) =>
        Iteratee.flatten(predicate(e).map { b =>
          if (b) new CheckDone[E, E] { def continue[A](k: K[E, A]) = Cont(step(k)) } &> k(in)
          else Cont(step(k))
        }(pec))

      case Input.Empty =>
        new CheckDone[E, E] { def continue[A](k: K[E, A]) = Cont(step(k)) } &> k(Input.Empty)

      case Input.EOF =>
        Done(Cont(k), Input.EOF)
    }

    def continue[A](k: K[E, A]) = Cont(step(k))

  }

  def findAssignable(user: User, teams: List[String])(implicit ctx: DBAccessContext) = {
    val alreadyDoneFilter = filterM[OpenAssignment]{ assignment =>
      AnnotationService.countTaskOf(user, assignment._task).futureBox.map(_.contains(0))
    }

    findNextAssignment(user, teams)(ctx) &> alreadyDoneFilter
  }

  def findAllAssignableFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[List[OpenAssignment]] = {
    findAssignable(user, teams) |>>> Iteratee.getChunks[OpenAssignment]
  }

  def findAssignableFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[OpenAssignment] = {
    findAssignable(user, teams) |>>> Iteratee.head[OpenAssignment]
  }

  def allNextTasksForUser(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[List[Task]] =
    findAllAssignableFor(user, teams).flatMap(assignments => Fox.serialSequence(assignments)(_.task).map(_.flatten))

  def nextTaskForUser(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[Task] =
    findAssignableFor(user, teams).flatMap(_.task)
}
