/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.reactivemongo

import com.scalableminds.util.reactivemongo.AccessRestrictions.{AllowIf, DenyEveryone}
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import net.liftweb.common.Failure
import play.api.libs.json.{JsObject, JsValue, Json}
import reactivemongo.api.commands.{GetLastError, WriteResult}
import reactivemongo.bson.BSONDocument
import reactivemongo.play.json._

import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.Future

trait SecuredCollection[T]
  extends AbstractCollection[T]
    with MongoHelpers
    with DBAccess
    with WithJsonFormatter[T]
    with ExceptionCatchers
    with FoxImplicits {

  val pack = reactivemongo.play.json.JSONSerializationPack

  def AccessDefinitions: DBAccessDefinition

  val AccessDeniedError = Failure("Access denied.")

  def combine(a: JsValue, b: JsValue) = {
    Json.obj("$and" -> Json.arr(a, b))
  }

  def insert(js: JsObject)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    if (ctx.globalAccess || AccessDefinitions.isAllowedToInsert) {
      withFailureHandler {
        val future = underlying.insert(js ++ AccessDefinitions.createACL(js))
        future.onFailure {
          case e: Throwable =>
            logger.error(s"Failed to insert Object into mongo. Js: $js", e)
        }
        future
      }
    } else {
      AccessDeniedError
    }
  }

  def bulkInsert(enumerator: Stream[JsObject])(implicit ctx: DBAccessContext): Fox[Int] = {
    if (ctx.globalAccess || AccessDefinitions.isAllowedToInsert) {
      withExceptionCatcher {
        val future = underlying.bulkInsert(
          enumerator.map(el => el ++ AccessDefinitions.createACL(el)),
          ordered = false,
          writeConcern = GetLastError.Acknowledged)
        future.onFailure {
          case e: Throwable =>
            logger.error(s"Failed to bulkInsert Objects into mongo.", e)
        }
        future.map(_.n)
      }
    } else {
      AccessDeniedError
    }
  }

  def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = findWithProjection(query, Json.obj())

  def findWithProjection(query: JsObject = Json.obj(), projection: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    AccessDefinitions.findQueryFilter match {
      case _ if ctx.globalAccess =>
        underlying.find(query, projection)
      case AllowIf(condition) =>
        underlying.find(combine(query, condition), projection)
      case DenyEveryone() =>
        // TODO: find a different way to abort the query
        underlying.find(Json.obj("$and" -> Json.arr(
          Json.obj("failAttribute" -> 1),
          Json.obj("failAttribute" -> Json.obj("$ne" -> 1)))))
    }
  }

  def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = withExceptionCatcher {
    find(query).one[T]
  }

  def update(query: JsObject, update: JsObject, upsert: Boolean = false, multi: Boolean = false)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    val isUpsertAllowed = upsert && (ctx.globalAccess || AccessDefinitions.isAllowedToInsert)
    val u =
      if (isUpsertAllowed)
        update ++ AccessDefinitions.createACL(update)
      else
        update

    def executeUpdate(q: JsObject) = withFailureHandler {
      underlying.update(
        q,
        u,
        upsert = isUpsertAllowed,
        multi = multi)
    }

    AccessDefinitions.updateQueryFilter match {
      case _ if ctx.globalAccess =>
        executeUpdate(query)
      case DenyEveryone() =>
        AccessDeniedError
      case AllowIf(condition) =>
        executeUpdate(combine(query, condition))
    }
  }

  def remove(js: JsObject)(implicit ctx: DBAccessContext): Fox[WriteResult] = {
    AccessDefinitions.removeQueryFilter match {
      case _ if ctx.globalAccess =>
        withFailureHandler(underlying.remove(js))
      case DenyEveryone() =>
        AccessDeniedError
      case AllowIf(condition) =>
        withFailureHandler(underlying.remove(combine(js, condition)))
    }
  }

  def count(query: JsObject)(implicit ctx: DBAccessContext): Fox[Int] = {
    def executeCount(q: JsObject) = withExceptionCatcher {
      underlying.count(Some(q))
    }

    AccessDefinitions.findQueryFilter match {
      case _ if ctx.globalAccess =>
        executeCount(query)
      case DenyEveryone() =>
        AccessDeniedError
      case AllowIf(condition) =>
        executeCount(combine(query, condition))
    }
  }

  def findAndModifyBson(query: JsObject, update: JsObject, returnNew: Boolean = true, upsert: Boolean = false)(implicit ctx: DBAccessContext): Fox[BSONDocument] = {
    val isUpsertAllowed = upsert && (ctx.globalAccess || AccessDefinitions.isAllowedToInsert)
    val u =
      if (isUpsertAllowed)
        update ++ AccessDefinitions.createACL(update)
      else
        update

    def executeFindAndModify(q: JsObject) = {
      underlying.findAndUpdate(q, u, returnNew, isUpsertAllowed).map(_.result[BSONDocument])
    }

    withExceptionCatcher {
      AccessDefinitions.updateQueryFilter match {
        case _ if ctx.globalAccess =>
          executeFindAndModify(query)
        case DenyEveryone() =>
          Future.successful(None)
        case AllowIf(condition) =>
          executeFindAndModify(combine(condition, query))
      }
    }
  }

}
