package braingames.reactivemongo

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 01:10
 */

import scala.concurrent.Future
import reactivemongo.core.commands.LastError
import play.api.libs.json.JsObject
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import scala.concurrent.ExecutionContext.Implicits._

trait SecuredMongoDAO[T] extends MongoDAO[T] with SecuredDAO[T] {
  this: MongoDAO[T] =>

}

trait UnsecuredMongoDAO[T] extends MongoDAO[T] with UnsecuredDAO[T] {
  this: MongoDAO[T] =>

}

trait UnsecuredDAO[T] extends SecuredDAO[T] with AllowEverytingDBAccessValidator {
  this: MongoDAO[T] =>
}

trait UnAuthedDBAccess{
  implicit val ctx: DBAccessContext = UnAuthedAccessContext
}

trait GlobalDBAccess {
  implicit val ctx: DBAccessContext = GlobalAccessContext
}

trait AllowEverytingDBAccessValidator extends DBAccessValidator {
  def isAllowedToInsert(implicit ctx: DBAccessContext): Boolean = true

  def removeQueryFilter(implicit ctx: DBAccessContext): AccessRestriction = AllowEveryone

  def updateQueryFilter(implicit ctx: DBAccessContext): AccessRestriction = AllowEveryone

  def findQueryFilter(implicit ctx: DBAccessContext): AccessRestriction = AllowEveryone
}

trait AllowEyerthingDBAccessFactory extends DBAccessFactory {
  def createACL(toInsert: JsObject)(implicit ctx: DBAccessContext): JsObject = Json.obj()
}

trait DBAccessFactory {
  def createACL(toInsert: JsObject)(implicit ctx: DBAccessContext): JsObject
}

trait DBAccessValidator {

  trait AccessRestriction

  val AllowEveryone = AllowIf(Json.obj())

  case class AllowIf(condition: JsObject) extends AccessRestriction

  case class DenyEveryone() extends AccessRestriction


  def isAllowedToInsert(implicit ctx: DBAccessContext): Boolean

  def removeQueryFilter(implicit ctx: DBAccessContext): AccessRestriction

  def updateQueryFilter(implicit ctx: DBAccessContext): AccessRestriction

  def findQueryFilter(implicit ctx: DBAccessContext): AccessRestriction
}

trait SecuredDAO[T] extends DBAccessValidator with DBAccessFactory with AllowEyerthingDBAccessFactory with AllowEverytingDBAccessValidator {
  this: MongoDAO[T] =>

  def AccessDeniedError =
    Future.successful(
      LastError(false, None, None, Some("Access denied"), None, 0, false))

  def withId(sid: String)(f: BSONObjectID => Future[LastError]): Future[LastError] =
    withId(sid, LastError(false, None, None, Some("Couldn't parse ObjectId"), None, 0, false))(f)

  def collectionInsert(js: JsObject)(implicit ctx: DBAccessContext): Future[LastError] = logError {
    if (ctx.globalAccess || isAllowedToInsert) {
      val future = collection.insert(js ++ createACL(js))
      future.onFailure {
        case e: Throwable =>
          System.err.println(e.toString)
      }
      future
    } else {
      AccessDeniedError
    }
  }

  def collectionFind(query: JsObject = Json.obj())(implicit ctx: DBAccessContext) = {
    findQueryFilter match {
      case _ if ctx.globalAccess =>
        collection.find(query)
      case AllowIf(condition) =>
        collection.find(query ++ condition)
      case DenyEveryone() =>
        // TODO: find a different way to abort the query
        collection.find(query ++ Json.obj("failAttribute" -> 1, "failAttribute" -> Json.obj("$ne" -> 1)))
    }
  }

  def logError(f: => Future[LastError]) = {
    f.map {
      r =>
        if (!r.ok)
          System.err.println("DB LastError: " + r)
        r
    }
  }

  def collectionUpdate(query: JsObject, update: JsObject, upsert: Boolean = false, multi: Boolean = false)(implicit ctx: DBAccessContext) = logError {
    val isUpsertAllowed = upsert && (ctx.globalAccess || isAllowedToInsert)
    val u =
      if (isUpsertAllowed)
        update ++ createACL(update)
      else
        update

    updateQueryFilter match {
      case DenyEveryone() =>
        AccessDeniedError
      case AllowIf(condition) =>
        val q =
          if (ctx.globalAccess)
            query
          else
            query ++ condition

        collection.update(
          q,
          u,
          upsert = isUpsertAllowed,
          multi = multi)
    }
  }

  def collectionRemove(js: JsObject)(implicit ctx: DBAccessContext) = {
    logError {
      removeQueryFilter match {
        case DenyEveryone() =>
          AccessDeniedError
        case _ if ctx.globalAccess =>
          collection.remove(js)
        case AllowIf(condition) =>
          collection.remove(js ++ condition)
      }
    }
  }
}