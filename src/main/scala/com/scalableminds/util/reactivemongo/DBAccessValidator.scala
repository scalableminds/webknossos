/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import com.scalableminds.util.reactivemongo.AccessRestrictions._


trait DBAccessValidator {

  def isAllowedToInsert(implicit ctx: DBAccessContext): Boolean

  def removeQueryFilter(implicit ctx: DBAccessContext): AccessRestriction

  def updateQueryFilter(implicit ctx: DBAccessContext): AccessRestriction

  def findQueryFilter(implicit ctx: DBAccessContext): AccessRestriction
}

trait AllowEverythingDBAccessValidator extends DBAccessValidator {
  def isAllowedToInsert(implicit ctx: DBAccessContext): Boolean = true

  def removeQueryFilter(implicit ctx: DBAccessContext): AccessRestriction = AllowEveryone

  def updateQueryFilter(implicit ctx: DBAccessContext): AccessRestriction = findQueryFilter(ctx)

  def findQueryFilter(implicit ctx: DBAccessContext): AccessRestriction = AllowEveryone
}
