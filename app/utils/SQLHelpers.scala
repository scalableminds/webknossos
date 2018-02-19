/*
 * Copyright (C) 2011-2018 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package utils


import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.user.User
import net.liftweb.common.Full
import play.api.Play.current
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import slick.dbio.DBIOAction
import slick.jdbc.PostgresProfile
import slick.jdbc.PostgresProfile.api._
import slick.lifted.{AbstractTable, Rep, TableQuery}

import scala.util.{Failure, Success, Try}


case class ObjectId(id: String) {
  def toBSONObjectId = BSONObjectID.parse(id).toOption
  override def toString = id
}

object ObjectId {
  implicit val jsonFormat = Json.format[ObjectId]
  def fromBsonId(bson: BSONObjectID) = ObjectId(bson.stringify)
  def generate = fromBsonId(BSONObjectID.generate)
}

object SQLClient {
  lazy val db: PostgresProfile.backend.Database = Database.forConfig("postgres", play.api.Play.configuration.underlying)
}

trait SimpleSQLDAO extends FoxImplicits with LazyLogging {

  def run[R](query: DBIOAction[R, NoStream, Nothing]): Fox[R] = {
    val foxFuture = SQLClient.db.run(query.asTry).map { result: Try[R] =>
      result match {
        case Success(res) => {
          Fox.successful(res)
        }
        case Failure(e: Throwable) => {
          logError(e, query)
          Fox.failure("SQL Failure: " + e.getMessage)
        }
      }
    }
    foxFuture.toFox.flatten
  }

  private def logError[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]) = {
    logger.error("SQL Error: " + ex)
    logger.debug("Caused by query:\n" + query.getDumpInfo.mainInfo)
  }



  def writeArrayTuple(elements: List[String]): String = {
    val commaSeparated = elements.mkString(",")
    s"{$commaSeparated}"
  }

  def writeStructTuple(elements: List[String]): String = {
    val commaSeparated = elements.mkString(",")
    s"($commaSeparated)"
  }

  def writeStructTupleWithQuotes(elements: List[String]): String = {
    val commaSeparated = elements.map(e => s"'$e'").mkString(",")
    s"($commaSeparated)"
  }

  def parseArrayTuple(literal: String): List[String] = {
    //TODO: error handling, escape handling. copy from js parser?
    val trimmed = literal.drop(1).dropRight(1)
    if (trimmed.isEmpty) List()
    else trimmed.split(",", -1).toList
  }

  def sanitize(aString: String): String = aString.replaceAll("'", "")

  def optionLiteral(aStringOpt: Option[String]): String = aStringOpt match {
    case Some(aString) => "'" + aString + "'"
    case None => "null"
  }

}

trait SecuredSQLDAO extends SimpleSQLDAO {
  def collectionName: String
  def existingCollectionName = collectionName + "_"

  def anonymousReadAccessQ: String = "false"
  def readAccessQ(requestingUserId: ObjectId): String = "true"
  def updateAccessQ(requestingUserId: ObjectId): String = readAccessQ(requestingUserId)
  def deleteAccessQ(requestingUserId: ObjectId): String = readAccessQ(requestingUserId)

  def readAccessQuery(implicit ctx: DBAccessContext): Fox[String] = {
    if (ctx.globalAccess) Fox.successful("true")
    else {
      for {
        userIdBox <- userIdFromCtx.futureBox
      } yield {
        userIdBox match {
          case Full(userId) => "(" + readAccessQ(userId) + ")"
          case _ => "(" + anonymousReadAccessQ + ")"
        }
      }
    }
  }

  def assertUpdateAccess(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx
        resultList <- run(sql"select _id from #${existingCollectionName} where _id = ${id.id} and #${updateAccessQ(userId)}".as[String]) ?~> "Failed to check write access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "Access denied."
      } yield ()
    }
  }

  def assertDeleteAccess(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx
        resultList <- run(sql"select _id from #${existingCollectionName} where _id = ${id.id} and #${deleteAccessQ(userId)}".as[String]) ?~> "Failed to check delete access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "Access denied."
      } yield ()
    }
  }

  //note that this needs to be guaranteed to be sanitized (currently so because it converts from BSONObjectID)
  private def userIdFromCtx(implicit ctx: DBAccessContext): Fox[ObjectId] = {
    ctx.data match {
      case Some(user: User) => Fox.successful(ObjectId.fromBsonId(user._id))
      case _ => Fox.failure("Access denied.")
    }
  }

}

trait SQLDAO[C, R, X <: AbstractTable[R]] extends SecuredSQLDAO {
  def collection: TableQuery[X]
  def collectionName = collection.shaped.value.schemaName.map(_ + ".").getOrElse("") + collection.shaped.value.tableName

  def idColumn(x: X): Rep[String]
  def isDeletedColumn(x: X): Rep[Boolean]

  def notdel(r: X) = isDeletedColumn(r) === false

  def parse(row: X#TableElementType): Fox[C]

  def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[C] = {
    run(collection.filter(r => isDeletedColumn(r) === false && idColumn(r) === id.id).result.headOption).map {
      case Some(r) =>
        parse(r) ?~> ("sql: could not parse database row for object" + id)
      case _ =>
        Fox.failure("sql: could not find object " + id)
    }.flatten
  }

  def findAll(implicit ctx: DBAccessContext): Fox[List[C]] =
    for {
      r <- run(collection.filter(row => notdel(row)).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def countAll(implicit ctx: DBAccessContext): Fox[Int] =
    run(collection.filter(row => notdel(row)).length.result)

  def deleteOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) === id.id)} yield isDeletedColumn(row)
    for {
      _ <- assertDeleteAccess(id)
      _ <- run(q.update(true))
    } yield ()
  }

  def updateStringCol(id: ObjectId, column: (X) => Rep[String], newValue: String)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) === id.id)} yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateObjectIdCol(id: ObjectId, column: (X) => Rep[String], newValue: ObjectId)(implicit ctx: DBAccessContext) =
    updateStringCol(id, column, newValue.id)

  def updateLongCol(id: ObjectId, column: (X) => Rep[Long], newValue: Long)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) === id.id)} yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateBooleanCol(id: ObjectId, column: (X) => Rep[Boolean], newValue: Boolean)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) === id.id)} yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateTimestampCol(id: ObjectId, column: (X) => Rep[java.sql.Timestamp], newValue: java.sql.Timestamp)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) === id.id)} yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

}
