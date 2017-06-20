/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package com.scalableminds.util.reactivemongo

import com.scalableminds.util.tools.Fox
import play.api.libs.json.{JsObject, Json}
import reactivemongo.api.collections.GenericQueryBuilder
import reactivemongo.api.commands.WriteResult
import reactivemongo.bson.BSONDocument
import reactivemongo.play.json.JSONSerializationPack

trait AbstractCollection[T]{
  def insert(t: JsObject)(implicit ctx: DBAccessContext): Fox[WriteResult]

  def bulkInsert(enumerator: Stream[JsObject])(implicit ctx: DBAccessContext): Fox[Int]

  def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext): Fox[T]

  def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext): GenericQueryBuilder[JSONSerializationPack.type]

  def update(query: JsObject, update: JsObject, upsert: Boolean = false, multi: Boolean = false)(implicit ctx: DBAccessContext): Fox[WriteResult]

  def remove(js: JsObject)(implicit ctx: DBAccessContext): Fox[WriteResult]

  def count(query: JsObject)(implicit ctx: DBAccessContext): Fox[Int]

  def findAndModifyBson(query: JsObject, update: JsObject, returnNew: Boolean = true, upsert: Boolean = false)(implicit ctx: DBAccessContext): Fox[BSONDocument]
}
