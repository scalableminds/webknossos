package utils

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import javax.inject.Inject
import models.user.User
import net.liftweb.common.Full
import oxalis.security.{SharingTokenContainer, UserSharingTokenContainer}
import oxalis.telemetry.SlackNotificationService.SlackNotificationService
import play.api.Configuration
import play.api.libs.json.{Json, JsonValidationError, Reads}
import reactivemongo.bson.BSONObjectID
import slick.dbio.DBIOAction
import slick.jdbc.{PositionedParameters, PostgresProfile, SetParameter}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.{AbstractTable, Rep, TableQuery}

import scala.collection.JavaConverters._
import scala.util.{Failure, Success, Try}
import play.api.data.validation.ValidationError

import scala.concurrent.ExecutionContext

class SQLClient @Inject()(configuration: Configuration, slackNotificationService: SlackNotificationService) {
  lazy val db: PostgresProfile.backend.Database = Database.forConfig("slick.db", configuration.underlying)
  def getSlackNotificationService = slackNotificationService
}

case class ObjectId(id: String) {
  override def toString = id
}

object ObjectId extends FoxImplicits {
  implicit val jsonFormat = Json.format[ObjectId]
  def generate = fromBsonId(BSONObjectID.generate)
  def parse(input: String)(implicit ec: ExecutionContext) =
    parseSync(input).toFox ?~> s"The passed resource id ‘$input’ is invalid"
  private def fromBsonId(bson: BSONObjectID) = ObjectId(bson.stringify)
  private def parseSync(input: String) = BSONObjectID.parse(input).map(fromBsonId).toOption

  def stringObjectIdReads(key: String) =
    Reads.filter[String](JsonValidationError("bsonid.invalid", key))(parseSync(_).isDefined)
}

trait SQLTypeImplicits {
  implicit object SetObjectId extends SetParameter[ObjectId] {
    def apply(v: ObjectId, pp: PositionedParameters) { pp.setString(v.id) }
  }
}

class SimpleSQLDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging
    with SQLTypeImplicits {

  lazy val transactionSerializationError = "could not serialize access"

  def run[R](query: DBIOAction[R, NoStream, Nothing],
             retryCount: Int = 0,
             retryIfErrorContains: List[String] = List()): Fox[R] = {
    val foxFuture = sqlClient.db.run(query.asTry).map { result: Try[R] =>
      result match {
        case Success(res) => {
          Fox.successful(res)
        }
        case Failure(e: Throwable) => {
          val msg = e.getMessage
          if (retryIfErrorContains.exists(msg.contains(_)) && retryCount > 0) {
            logger.debug(s"Retrying SQL Query (${retryCount} remaining) due to ${msg}")
            Thread.sleep(20)
            run(query, retryCount - 1, retryIfErrorContains)
          } else {
            logError(e, query)
            reportErrorToSlack(e, query)
            Fox.failure("SQL Failure: " + e.getMessage)
          }
        }
      }
    }
    foxFuture.toFox.flatten
  }

  private def logError[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]) = {
    logger.error("SQL Error: " + ex)
    logger.debug("Caused by query:\n" + query.getDumpInfo.mainInfo)
  }

  private def reportErrorToSlack[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]) =
    sqlClient.getSlackNotificationService.noticeError(ex, s"Causing query: ${query.getDumpInfo.mainInfo}")

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
    case None          => "null"
  }

}

abstract class SecuredSQLDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  def collectionName: String
  def existingCollectionName = collectionName + "_"

  def anonymousReadAccessQ(sharingToken: Option[String]): String = "false"
  def readAccessQ(requestingUserId: ObjectId): String = "true"
  def updateAccessQ(requestingUserId: ObjectId): String = readAccessQ(requestingUserId)
  def deleteAccessQ(requestingUserId: ObjectId): String = readAccessQ(requestingUserId)

  def readAccessQuery(implicit ctx: DBAccessContext): Fox[String] =
    if (ctx.globalAccess) Fox.successful("true")
    else {
      for {
        userIdBox <- userIdFromCtx.futureBox
      } yield {
        userIdBox match {
          case Full(userId) => "(" + readAccessFromUserOrToken(userId, sharingTokenFromCtx)(ctx) + ")"
          case _            => "(" + anonymousReadAccessQ(sharingTokenFromCtx) + ")"
        }
      }
    }

  def assertUpdateAccess(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx ?~> "FAILED: userIdFromCtx"
        resultList <- run(
          sql"select _id from #${existingCollectionName} where _id = ${id.id} and #${updateAccessQ(userId)}"
            .as[String]) ?~> "Failed to check write access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "Access denied."
      } yield ()
    }

  def assertDeleteAccess(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx
        resultList <- run(
          sql"select _id from #${existingCollectionName} where _id = ${id.id} and #${deleteAccessQ(userId)}"
            .as[String]) ?~> "Failed to check delete access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "Access denied."
      } yield ()
    }

  def userIdFromCtx(implicit ctx: DBAccessContext): Fox[ObjectId] =
    ctx.data match {
      case Some(user: User) => Fox.successful(user._id)
      case Some(userSharingTokenContainer: UserSharingTokenContainer) =>
        Fox.successful(userSharingTokenContainer.user._id)
      case _ => Fox.failure("Access denied.")
    }

  def accessQueryFromAccessQ(accessQ: ObjectId => String)(implicit ctx: DBAccessContext): Fox[String] =
    if (ctx.globalAccess) Fox.successful("true")
    else {
      for {
        userIdBox <- userIdFromCtx.futureBox
      } yield {
        userIdBox match {
          case Full(userId) => "(" + accessQ(userId) + ")"
          case _            => "(false)"
        }
      }
    }

  private def sharingTokenFromCtx(implicit ctx: DBAccessContext): Option[String] =
    ctx.data match {
      case Some(sharingTokenContainer: SharingTokenContainer) => Some(sanitize(sharingTokenContainer.sharingToken))
      case Some(userSharingTokenContainer: UserSharingTokenContainer) =>
        userSharingTokenContainer.sharingToken.map(sanitize)
      case _ => None
    }

  private def readAccessFromUserOrToken(userId: ObjectId, tokenOption: Option[String])(
      implicit ctx: DBAccessContext): String =
    tokenOption match {
      case Some(_) => "((" + anonymousReadAccessQ(sharingTokenFromCtx) + ") OR (" + readAccessQ(userId) + "))"
      case _       => "(" + readAccessQ(userId) + ")"
    }

}

abstract class SQLDAO[C, R, X <: AbstractTable[R]] @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SecuredSQLDAO(sqlClient) {
  def collection: TableQuery[X]
  def collectionName = collection.shaped.value.schemaName.map(_ + ".").getOrElse("") + collection.shaped.value.tableName

  def columnsList = collection.baseTableRow.create_*.map(_.name).toList
  def columns = columnsList.mkString(", ")
  def columnsWithPrefix(prefix: String) = columnsList.map(prefix + _).mkString(", ")

  def idColumn(x: X): Rep[String]
  def isDeletedColumn(x: X): Rep[Boolean]

  def notdel(r: X) = isDeletedColumn(r) === false

  def parse(row: X#TableElementType): Fox[C]

  def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[C] =
    run(collection.filter(r => isDeletedColumn(r) === false && idColumn(r) === id.id).result.headOption).map {
      case Some(r) =>
        parse(r) ?~> ("sql: could not parse database row for object" + id)
      case _ =>
        Fox.failure("sql: could not find object " + id)
    }.flatten

  def findAll(implicit ctx: DBAccessContext): Fox[List[C]] =
    for {
      r <- run(collection.filter(row => notdel(row)).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def countAll(implicit ctx: DBAccessContext): Fox[Int] =
    run(collection.filter(row => notdel(row)).length.result)

  def deleteOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield isDeletedColumn(row)
    for {
      _ <- assertDeleteAccess(id)
      _ <- run(q.update(true))
    } yield ()
  }

  def updateStringCol(id: ObjectId, column: (X) => Rep[String], newValue: String)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateObjectIdCol(id: ObjectId, column: (X) => Rep[String], newValue: ObjectId)(implicit ctx: DBAccessContext) =
    updateStringCol(id, column, newValue.id)

  def updateLongCol(id: ObjectId, column: (X) => Rep[Long], newValue: Long)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateBooleanCol(id: ObjectId, column: (X) => Rep[Boolean], newValue: Boolean)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateTimestampCol(id: ObjectId, column: (X) => Rep[java.sql.Timestamp], newValue: java.sql.Timestamp)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

}
