/*
 * Copyright (C) 2011-2017 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package models.task

import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import models.user.User
import play.api.libs.concurrent.Execution.Implicits.{defaultContext => dec}

object TaskAssignmentService extends FoxImplicits {

  def findOneAssignableFor(user: User, teams: List[String])(implicit ctx: DBAccessContext): Fox[Task] =
    (for {
      list <- findAllAssignableFor(user, teams, Some(1))
    } yield list.headOption.toFox).flatten

  def findAllAssignableFor(user: User, teams: List[String], limit: Option[Int] = None)(implicit ctx: DBAccessContext): Fox[List[Task]] = {
    TaskDAO.findAllAssignableFor(user, teams, limit)
  }

}
