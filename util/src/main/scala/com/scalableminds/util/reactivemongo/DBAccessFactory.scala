/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import play.api.libs.json.{JsObject, Json}

trait DBAccessFactory {
  def createACL(toInsert: JsObject)(implicit ctx: DBAccessContext): JsObject
}

trait AllowEverythingDBAccessFactory extends DBAccessFactory {
  def createACL(toInsert: JsObject)(implicit ctx: DBAccessContext): JsObject = Json.obj()
}
