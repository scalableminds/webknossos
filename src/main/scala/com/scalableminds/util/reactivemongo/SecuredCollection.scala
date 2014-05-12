/*
* Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
*/
package com.scalableminds.util.reactivemongo

import scala.concurrent.Future
import reactivemongo.core.commands.{Update, Count, FindAndModify, LastError}
import play.api.libs.json.{JsValue, JsObject, Json}
import reactivemongo.bson.BSONDocument
import scala.concurrent.ExecutionContext.Implicits._
import reactivemongo.api.DefaultDB
import play.modules.reactivemongo.json.BSONFormats.BSONDocumentFormat
import net.liftweb.common.{Empty, Failure}
import reactivemongo.core.errors.GenericDatabaseException
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.scalableminds.util.reactivemongo.AccessRestrictions.{DenyEveryone, AllowIf}

trait SecuredCollection[T] extends AbstractCollection[T] with DBInteractionLogger with MongoHelpers with DBAccess with WithJsonFormatter[T] with ExceptionCatchers with FoxImplicits{

  def AccessDefinitions: DBAccessDefinition

  val AccessDeniedError = Failure("Access denied.")

  def combine(a: JsValue, b: JsValue) = {
    Json.obj("$and" -> Json.arr(a, b))
  }

  def insert(js: JsObject)(implicit ctx: DBAccessContext): Fox[LastError] = {
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

  def find(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    AccessDefinitions.findQueryFilter match {
      case _ if ctx.globalAccess =>
        underlying.find(query)
      case AllowIf(condition) =>
        underlying.find(combine(query, condition))
      case DenyEveryone() =>
        // TODO: find a different way to abort the query
        underlying.find(Json.obj("$and" -> Json.arr(
          Json.obj("failAttribute" -> 1),
          Json.obj("failAttribute" -> Json.obj("$ne" -> 1)))))
    }
  }

  def findOne(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(query).one[T]
  }

  def update(query: JsObject, update: JsObject, upsert: Boolean = false, multi: Boolean = false)(implicit ctx: DBAccessContext): Fox[LastError] = {
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

  def remove(js: JsObject)(implicit ctx: DBAccessContext): Fox[LastError] = {
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
      db.command(Count(underlying.name, Some(BSONDocumentFormat.reads(q).get)))
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
      db.command(
        FindAndModify(underlying.name,
          BSONDocumentFormat.reads(q).get,
          Update(BSONDocumentFormat.reads(u).get, returnNew), upsert = isUpsertAllowed))
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