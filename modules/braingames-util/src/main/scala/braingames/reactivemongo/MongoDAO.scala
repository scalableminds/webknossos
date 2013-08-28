package braingames.reactivemongo

/**
 * Company: scalableminds
 * User: tmbo
 * Date: 10.06.13
 * Time: 00:59
 */

import play.modules.reactivemongo.json.collection.JSONCollection
import reactivemongo.api._
import play.api.libs.json._
import reactivemongo.api.DefaultDB
import reactivemongo.bson.BSONObjectID
import play.modules.reactivemongo.json.BSONFormats._
import play.api.libs.json.Writes
import scala.concurrent.ExecutionContext.Implicits._
import scala.concurrent.Future
import reactivemongo.core.commands.LastError
import reactivemongo.api.collections.GenericQueryBuilder
import scala.Some
import reactivemongo.api.QueryOpts
import scala.util.Success
import reactivemongo.api.DefaultDB
import play.api.libs.json.JsObject

trait DAO[T] extends BaseDAO[T] {
  def findHeadOption(attribute: String, value: String)(implicit ctx: DBAccessContext): Future[Option[T]]

  def findSome(offset: Int, limit: Int, orderBy: String = defaultOrderBy)(implicit ctx: DBAccessContext): Future[List[T]]

  def findAll(implicit ctx: DBAccessContext): Future[List[T]]

  def findOneById(id: String)(implicit ctx: DBAccessContext): Future[Option[T]]

  def findOneById(bid: BSONObjectID)(implicit ctx: DBAccessContext): Future[Option[T]]

  def removeById(id: String)(implicit ctx: DBAccessContext): Future[LastError]

  def removeAll(implicit ctx: DBAccessContext): Future[LastError]

  def collectionName: String

  def defaultOrderBy: String
}

trait BaseDAO[T] {
  def collectionInsert(t: JsObject)(implicit ctx: DBAccessContext): Future[LastError]

  def collectionFind(query: JsObject = Json.obj())(implicit ctx: DBAccessContext): GenericQueryBuilder[JsObject, play.api.libs.json.Reads, play.api.libs.json.Writes]

  def collectionUpdate(query: JsObject, update: JsObject, upsert: Boolean = false, multi: Boolean = false)(implicit ctx: DBAccessContext): Future[LastError]

  def collectionRemove(js: JsObject)(implicit ctx: DBAccessContext): Future[LastError]
}

case class AuthedAccessContext(t: DBAccessContextPayload) extends DBAccessContext {
  override def data = Some(t)
}

case object UnAuthedAccessContext extends DBAccessContext

case object GlobalAccessContext extends DBAccessContext {
  override val globalAccess = true
}

trait DBAccessContext {
  def data: Option[DBAccessContextPayload] = None

  def globalAccess: Boolean = false
}

trait DBAccessContextPayload

trait MongoDAO[T] extends DAO[T] with MongoHelpers {


  def collectionName: String

  def db: DefaultDB

  implicit def formatter: OFormat[T]

  def formatWithoutId(t: T) = {
    val js = formatter.writes(t)
    js.transform(removeId).getOrElse{
      System.err.println("Couldn't remove ID from: " + js)
      js
    }
  }

  def defaultOrderBy = "_id"


  lazy val collection = db.collection[JSONCollection](collectionName)

  def errorFromMsg(msg: String) = {
    LastError(ok = false, None, None, Some(msg), None, 0, false)
  }

  def findHeadOption(attribute: String, value: String)(implicit ctx: DBAccessContext) = {
    findByAttribute(attribute, value).one[T]
  }

  def findOne(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj()).one[T]
  }

  def findOne(attribute: String, value: String)(implicit ctx: DBAccessContext) = {
    findByAttribute(attribute, value).one[T]
  }

  def findMaxBy(attribute: String)(implicit ctx: DBAccessContext) = {
    findOrderedBy(attribute, -1, 1).map(_.headOption)
  }

  def findMinBy(attribute: String)(implicit ctx: DBAccessContext) = {
    findOrderedBy(attribute, 1, 1).map(_.headOption)
  }

  def findOrderedBy(attribute: String, desc: Int, limit: Int = 1)(implicit ctx: DBAccessContext) = {
    collectionFind().sort(Json.obj(attribute -> desc)).cursor[T].collect[List](limit)
  }

  private def findByAttribute(attribute: String, value: String)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj(attribute -> value))
  }

  def find(attribute: String, value: String)(implicit ctx: DBAccessContext) = {
    findByAttribute(attribute, value).cursor[T]
  }

  def find(query: JsObject)(implicit ctx: DBAccessContext) = {
    collectionFind(query).cursor[T]
  }

  def remove(attribute: String, value: String)(implicit ctx: DBAccessContext): Future[LastError] = {
    collectionRemove(Json.obj(attribute -> value))
  }

  def findSome(offset: Int, limit: Int, orderBy: String = defaultOrderBy)(implicit ctx: DBAccessContext): Future[List[T]] = {
    takeSome(
      collectionFind(Json.obj()),
      offset,
      limit,
      orderBy)
  }

  def takeSome(q: GenericQueryBuilder[JsObject, Reads, Writes], offset: Int, limit: Int, orderBy: String = defaultOrderBy) = {
    val options = QueryOpts(skipN = offset, batchSizeN = limit)
    val document = Json.obj(
      orderBy -> 1)
    q
      .options(options)
      .sort(document)
      .cursor[T]
      .collect[List](limit)
  }

  def findAll(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj()).cursor[T].toList
  }

  def toMongoObjectIdString(id: String) =
    BSONObjectID.parse(id).map(oid => Json.toJson(oid).toString).toOption

  def withId[T](id: String, errorValue: => T)(f: BSONObjectID => Future[T]) = {
    BSONObjectID.parse(id) match {
      case Success(bid) =>
        f(bid)
      case _ =>
        System.err.println(s"Failed to parse objectId: $id")
        Future.successful(errorValue)
    }
  }

  def findByEither(fields: (String, Function[String, Option[String]])*)(query: String)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj(
      "$or" -> fields.flatMap {
        case (field, mapper) =>
          mapper(query).map(value => Json.obj(field -> value))
      }))
  }

  def findOneById(id: String)(implicit ctx: DBAccessContext) = {
    withId[Option[T]](id, errorValue = None) {
      bid =>
        findOneById(bid)
    }
  }

  def findOneById(bid: BSONObjectID)(implicit ctx: DBAccessContext) = {
    collectionFind(Json.obj("_id" -> bid)).one[T]
  }

  def removeById(id: String)(implicit ctx: DBAccessContext) = {
    withId(id, errorValue = LastError(false, None, None, Some(s"failed to parse objectId $id"), None, 0, false)) {
      bid =>
        collectionRemove(Json.obj("_id" -> new BSONObjectID(id)))
    }
  }

  def removeAll(implicit ctx: DBAccessContext) = {
    collectionRemove(Json.obj())
  }

  def update(id: BSONObjectID, t: T)(implicit ctx: DBAccessContext): Future[LastError] = {
    collectionUpdate(Json.obj("_id" -> id), formatter.writes(t))
  }

  def insert(t: T)(implicit ctx: DBAccessContext): Future[LastError] = {
    collectionInsert(formatter.writes(t))
  }
}