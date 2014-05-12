/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import play.api.libs.json.{Json, JsObject}
import reactivemongo.core.commands.LastError
import reactivemongo.api.collections.GenericQueryBuilder
import reactivemongo.bson.BSONDocument
import com.scalableminds.util.tools.Fox

trait AbstractCollection[T]{
  def insert(t: JsObject)(implicit ctx: DBAccessContext): Fox[LastError]

  def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext): Fox[T]

  def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext): GenericQueryBuilder[JsObject, play.api.libs.json.Reads, play.api.libs.json.Writes]

  def update(query: JsObject, update: JsObject, upsert: Boolean = false, multi: Boolean = false)(implicit ctx: DBAccessContext): Fox[LastError]

  def remove(js: JsObject)(implicit ctx: DBAccessContext): Fox[LastError]

  def count(query: JsObject)(implicit ctx: DBAccessContext): Fox[Int]

  def findAndModifyBson(query: JsObject, update: JsObject, returnNew: Boolean = true, upsert: Boolean = false)(implicit ctx: DBAccessContext): Fox[BSONDocument]
}