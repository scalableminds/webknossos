/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.annotation.AnnotationService
import models.project.Project
import models.user.User
import play.api.libs.iteratee.Enumeratee.CheckDone
import play.api.libs.iteratee._
import reactivemongo.api.commands.WriteResult
import play.api.libs.concurrent.Execution.Implicits.{defaultContext => dec}

import scala.concurrent.{ExecutionContext, Future}

object TaskAssignmentService extends FoxImplicits {

  def findAllAssignableFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[List[Task]] =
    findAssignable(user, teams) |>>> Iteratee.getChunks[Task]

  def findOneAssignableFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[Task] =
    findAssignable(user, teams) |>>> Iteratee.head[Task]

  def findNAssignableFor(user: User, teams: List[String], limit: Int)(implicit ctx: DBAccessContext): Fox[Seq[Task]] =
    findAssignable(user, teams) |>>> takeUpTo[Task](limit)

  private def findAssignable(user: User, teams: List[String])(implicit ctx: DBAccessContext): Enumerator[Task] = {
    val notDoneYetFilter = filterM[Task] { task =>
      AnnotationService.countTaskOf(user, task._id).futureBox.map(_.contains(0))
    }

    TaskDAO.findOrderedByPriorityFor(user, teams) &> notDoneYetFilter
  }


  def takeInstance(task: Task)(implicit ctx: DBAccessContext): Fox[WriteResult] =
    TaskDAO.decrementOpenInstanceCount(task._id)

  def putBackInstance(task: Task)(implicit ctx: DBAccessContext) =
    TaskDAO.incrementOpenInstanceCount(task._id)


  //TODO: there’s got to be something in the standard library for this?
  private def takeUpTo[E](n: Int): Iteratee[E, Seq[E]] = {
    def stepWith(accum: Seq[E]): Iteratee[E, Seq[E]] = {
      if (accum.length >= n) Done(accum) else Cont {
        case Input.EOF =>
          Done(accum, Input.EOF)
        case Input.Empty =>
          stepWith(accum)
        case Input.El(el) =>
          stepWith(accum)
      }
    }

    stepWith(Seq.empty)
  }


  //TODO: there’s got to be something in the standard library for this?
  /**
    * Create an Enumeratee that filters the inputs using the given predicate
    *
    * @param predicate A function to filter the input elements.
    * $paramEcSingle
    */
  private def filterM[E](predicate: E => Future[Boolean])(implicit ec: ExecutionContext): Enumeratee[E, E] = new CheckDone[E, E] {
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



}
