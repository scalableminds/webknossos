/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.reactivemongo

import net.liftweb.common.{Failure, Full}
import play.api.libs.json._
import reactivemongo.play.json.JSONSerializationPack
import reactivemongo.api.commands.{LastError, WriteResult}
import reactivemongo.bson.BSONObjectID
import reactivemongo.play.json.BSONFormats._
import play.api.libs.json.Writes

import scala.concurrent.ExecutionContext.Implicits._
import reactivemongo.api.collections.GenericQueryBuilder

import scala.Some
import reactivemongo.api.{Cursor, QueryOpts}
import play.api.libs.json.JsObject
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.iteratee.Enumerator

trait CollectionHelpers[T]
  extends DAO[T]
          with MongoHelpers
          with WithJsonFormatter[T]
          with ExceptionCatchers
          with LazyLogging {
  this: AbstractCollection[T] =>

  def formatWithoutId(t: T) = {
    val js = formatter.writes(t)
    js.transform(removeId).getOrElse {
      logger.warn("Couldn't remove ID from: " + js)
      js
    }
  }

  def defaultOrderBy = "_id"

  def errorFromMsg(msg: String) = {
    LastError(ok = false, Some(msg), None, None, 0, None, false, None, None, false, None, None)
  }

  def findHeadOption[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Fox[T] = withExceptionCatcher {
    findByAttribute(attribute, w.writes(value)).one[T]
  }

  def findOne[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Fox[T] = {
    findOne(Json.obj(attribute -> w.writes(value)))
  }

  def findMaxBy(attribute: String)(implicit ctx: DBAccessContext) = {
    findOrderedBy(attribute, -1, 1).map(_.headOption)
  }

  def findMinBy(attribute: String)(implicit ctx: DBAccessContext) = {
    findOrderedBy(attribute, 1, 1).map(_.headOption)
  }

  def findOrderedBy(attribute: String, desc: Int, limit: Int = 1)(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find().sort(Json.obj(attribute -> desc)).cursor[T]().collect[List](limit)
  }

  private def findByAttribute(attribute: String, value: JsValue)(implicit ctx: DBAccessContext) = {
    find(Json.obj(attribute -> value))
  }

  def find[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Cursor[T] = {
    findByAttribute(attribute, w.writes(value)).cursor[T]()
  }

  //  def find(query: JsObject)(implicit ctx: DBAccessContext) = {
  //    this.find(query).cursor[T]
  //  }

  def remove[V](attribute: String, value: V)(implicit w: Writes[V], ctx: DBAccessContext): Fox[WriteResult] = {
    remove(Json.obj(attribute -> w.writes(value)))
  }

  def findSome(offset: Int, limit: Int, orderBy: String = defaultOrderBy)(implicit ctx: DBAccessContext): Fox[List[T]] = {
    takeSome(
      find(),
      offset,
      limit,
      orderBy)
  }

  def takeSome(q: GenericQueryBuilder[JSONSerializationPack.type], offset: Int, limit: Int, orderBy: String = defaultOrderBy) = withExceptionCatcher {
    val options = QueryOpts(skipN = offset, batchSizeN = limit)
    val document = Json.obj(
      orderBy -> 1)
    q
      .options(options)
      .sort(document)
      .cursor[T]()
      .collect[List](limit)
  }

  def findAll(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(Json.obj()).cursor[T]().collect[List]()
  }

  def toMongoObjectIdString(id: String) =
    BSONObjectID.parse(id).map(oid => Json.toJson(oid).toString).toOption


  def findByEither(fields: (String, Function[String, Option[String]])*)(query: String)(implicit ctx: DBAccessContext) = {
    find(Json.obj(
      "$or" -> fields.flatMap {
        case (field, mapper) =>
          mapper(query).map(value => Json.obj(field -> value))
      }))
  }

  def findOneById(bid: BSONObjectID)(implicit ctx: DBAccessContext): Fox[T] = withExceptionCatcher {
    find(Json.obj("_id" -> bid)).one[T]
  }

  def findOneById(id: String)(implicit ctx: DBAccessContext): Fox[T] = {
    withId(id) {
      bid =>
        findOneById(bid)
    }
  }

  def removeById(bid: BSONObjectID)(implicit ctx: DBAccessContext) = {
    remove(Json.obj("_id" -> bid))
  }

  def removeById(id: String)(implicit ctx: DBAccessContext) = {
    withId(id) {
      bid =>
        removeById(bid)
    }
  }

  def findAndModify(query: JsObject, update: JsObject, returnNew: Boolean = true, upsert: Boolean = false)(implicit ctx: DBAccessContext) = {
    findAndModifyBson(query, update, returnNew, upsert).map(bson => formatter.reads(Json.toJson(bson)).get)
  }

  def removeAll(implicit ctx: DBAccessContext) = {
    remove(Json.obj())
  }

  def update(id: BSONObjectID, t: T)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    update(Json.obj("_id" -> id), formatter.writes(t))
  }

  def insert(t: T)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    insert(formatter.writes(t))
  }

  def bulkInsert(t: Seq[T])(implicit ctx: DBAccessContext): Fox[Int] = {
    bulkInsert(t.toStream.map(formatter.writes)).flatMap{
      case insertedElements if insertedElements == t.size =>
        Full(insertedElements)
      case x =>
        Failure(s"Bulk insert failed (inserted: $x elements, expected: ${t.size}).")
    }
  }
}