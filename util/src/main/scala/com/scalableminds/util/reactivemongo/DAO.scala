/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import com.scalableminds.util.tools.Fox
import play.api.libs.json.Writes
import reactivemongo.api.commands.WriteResult
import reactivemongo.bson.BSONObjectID

trait DAO[T]{

  def defaultOrderBy: String

  def findHeadOption[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Fox[T]

  def findSome(offset: Int, limit: Int, orderBy: String = defaultOrderBy)(implicit ctx: DBAccessContext): Fox[List[T]]

  def findAll(implicit ctx: DBAccessContext): Fox[List[T]]

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[T]

  def findOneById(bid: BSONObjectID)(implicit ctx: DBAccessContext): Fox[T]

  def removeById(id: String)(implicit ctx: DBAccessContext): Fox[WriteResult]

  def removeAll(implicit ctx: DBAccessContext): Fox[WriteResult]
}
