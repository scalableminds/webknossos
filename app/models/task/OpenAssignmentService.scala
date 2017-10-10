/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.project.Project
import models.user.User
import play.api.libs.iteratee.Enumerator
import reactivemongo.api.commands.WriteResult
import reactivemongo.bson.BSONObjectID

object OpenAssignmentService extends FoxImplicits{
  def findNextOpenAssignments(user: User, teams: List[String])(implicit ctx: DBAccessContext): Enumerator[OpenAssignment] = {
    OpenAssignmentDAO.findOrderedByPriority(user, teams)
  }

  def findAllOpenAssignments(implicit ctx: DBAccessContext): Enumerator[OpenAssignment] = {
    OpenAssignmentDAO.findOrderedByPriority
  }

  def removeByTask(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    OpenAssignmentDAO.removeByTask(_task)

  def removeByProject(project: Project)(implicit ctx: DBAccessContext) =
    OpenAssignmentDAO.removeByProject(project.name)

  def take(assignment: OpenAssignment)(implicit ctx: DBAccessContext): Fox[WriteResult] =
    OpenAssignmentDAO.decrementInstanceCount(assignment._id)

  def insertOneFor(task: Task, project: Project)(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.insert(OpenAssignment.from(task, project, 1))
  }

  def countOpenAssignments(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.countOpenAssignments
  }

  def insertInstancesFor(task: Task, project: Project, remainingInstances: Int)(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.insert(OpenAssignment.from(task, project, remainingInstances))
  }

  def updateRemainingInstances(task: Task, project: Project, remainingInstances: Int)(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.updateRemainingInstances(task, project, remainingInstances)
  }

  def updateAllOfProject(name: String, project: Project)(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.updateAllOf(name, project).toFox
  }
}
