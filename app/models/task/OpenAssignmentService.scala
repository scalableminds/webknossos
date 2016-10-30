/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.project.Project
import models.user.User
import play.api.libs.iteratee.Enumerator
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import play.api.libs.concurrent.Execution.Implicits._

object OpenAssignmentService extends FoxImplicits{
  def findNextOpenAssignments(user: User)(implicit ctx: DBAccessContext): Enumerator[OpenAssignment] = {
    OpenAssignmentDAO.findOrderedByPriority(user)
  }

  def findAllOpenAssignments(implicit ctx: DBAccessContext): Enumerator[OpenAssignment] = {
    OpenAssignmentDAO.findOrderedByPriority
  }

  def removeByTask(_task: BSONObjectID)(implicit ctx: DBAccessContext) =
    OpenAssignmentDAO.removeByTask(_task)

  def removeByProject(project: Project)(implicit ctx: DBAccessContext) =
    OpenAssignmentDAO.removeByProject(project.name)

  def remove(assignment: OpenAssignment)(implicit ctx: DBAccessContext) =
    OpenAssignmentDAO.removeById(assignment._id)

  def insertOneFor(task: Task, project: Project)(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.insert(OpenAssignment.from(task, project))
  }

  def countOpenAssignments(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.countOpenAssignments
  }

  def insertInstancesFor(task: Task, project: Project, remainingInstances: Int)(implicit ctx: DBAccessContext) = {
    val assignments = List.fill(remainingInstances)(OpenAssignment.from(task, project))
    Fox.serialSequence(assignments)(a => OpenAssignmentDAO.insert(a))
  }

  def updateAllOf(task: Task, project: Project, remainingInstances: Int)(implicit ctx: DBAccessContext) = {
    for{
      _ <- removeByTask(task._id)
      _ <- insertInstancesFor(task, project, remainingInstances).toFox
    } yield true
  }

  def updateAllOfProject(name: String, project: Project)(implicit ctx: DBAccessContext) = {
    OpenAssignmentDAO.updateAllOf(name, project).toFox
  }
}
