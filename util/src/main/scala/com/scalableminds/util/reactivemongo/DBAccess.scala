/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import reactivemongo.api.DB
import reactivemongo.play.json.collection.JSONCollection

trait UnAuthorizedDBAccess {
  implicit val ctx: DBAccessContext = UnAuthorizedAccessContext
}

trait GlobalDBAccess {
  implicit val ctx: DBAccessContext = GlobalAccessContext
}

trait DefaultAccessDefinitions
  extends DBAccessDefinition with AllowEverythingDBAccessFactory with AllowEverythingDBAccessValidator

trait DBAccessDefinition extends DBAccessFactory with DBAccessValidator

trait DBAccess {
  def collectionName: String

  lazy val underlying: JSONCollection = db.collection(collectionName)

  def db: DB
}