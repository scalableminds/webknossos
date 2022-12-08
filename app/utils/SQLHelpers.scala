package utils

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import com.typesafe.scalalogging.LazyLogging
import models.user.User
import net.liftweb.common.Full
import oxalis.security.{SharingTokenContainer, UserSharingTokenContainer}
import oxalis.telemetry.SlackNotificationService
import play.api.Configuration
import slick.dbio.DBIOAction
import slick.jdbc.PostgresProfile.api._
import slick.jdbc.{GetResult, PositionedParameters, PositionedResult, PostgresProfile, SetParameter}
import slick.lifted.{AbstractTable, Rep, TableQuery}

import javax.inject.Inject
import scala.annotation.nowarn
import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success, Try}

class SQLClient @Inject()(configuration: Configuration, slackNotificationService: SlackNotificationService) {
  lazy val db: PostgresProfile.backend.Database = Database.forConfig("slick.db", configuration.underlying)
  def getSlackNotificationService: SlackNotificationService = slackNotificationService
}

trait SQLTypeImplicits {
  implicit object SetObjectId extends SetParameter[ObjectId] {
    def apply(v: ObjectId, pp: PositionedParameters): Unit = pp.setString(v.id)
  }

  implicit object SetObjectIdOpt extends SetParameter[Option[ObjectId]] {
    def apply(v: Option[ObjectId], pp: PositionedParameters): Unit = pp.setStringOption(v.map(_.id))
  }

  implicit object GetObjectId extends GetResult[ObjectId] {
    override def apply(v1: PositionedResult): ObjectId = ObjectId(v1.<<)
  }

  implicit object SetInstant extends SetParameter[Instant] {
    def apply(v: Instant, pp: PositionedParameters): Unit = pp.setTimestamp(v.toSql)
  }

  implicit object SetInstantOpt extends SetParameter[Option[Instant]] {
    def apply(v: Option[Instant], pp: PositionedParameters): Unit = pp.setTimestampOption(v.map(_.toSql))
  }

  implicit object GetInstant extends GetResult[Instant] {
    override def apply(v1: PositionedResult): Instant = Instant.fromSql(v1.<<)
  }

  implicit object GetInstantOpt extends GetResult[Option[Instant]] {
    override def apply(v1: PositionedResult): Option[Instant] = v1.nextTimestampOption().map(Instant.fromSql)
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
        case Success(res) =>
          Fox.successful(res)
        case Failure(e: Throwable) =>
          val msg = e.getMessage
          if (retryIfErrorContains.exists(msg.contains(_)) && retryCount > 0) {
            logger.debug(s"Retrying SQL Query ($retryCount remaining) due to $msg")
            Thread.sleep(20)
            run(query, retryCount - 1, retryIfErrorContains)
          } else {
            logError(e, query)
            reportErrorToSlack(e, query)
            Fox.failure("SQL Failure: " + e.getMessage)
          }
      }
    }
    foxFuture.toFox.flatten
  }

  private def logError[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]): Unit = {
    logger.error("SQL Error: " + ex)
    logger.debug("Caused by query:\n" + query.getDumpInfo.mainInfo)
  }

  private def reportErrorToSlack[R](ex: Throwable, query: DBIOAction[R, NoStream, Nothing]): Unit =
    sqlClient.getSlackNotificationService.warnWithException(
      "SQL Error",
      ex,
      s"Causing query: ${query.getDumpInfo.mainInfo}"
    )

  def writeArrayTuple(elements: List[String]): String = {
    val commaSeparated = elements.map(sanitizeInArrayTuple).map(e => s""""$e"""").mkString(",")
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
    val trimmed = literal.drop(1).dropRight(1)
    if (trimmed.isEmpty)
      List.empty
    else {
      val split = trimmed.split(",", -1).toList.map(desanitizeFromArrayTuple)
      split.map { item =>
        if (item.startsWith("\"") && item.endsWith("\"")) {
          item.drop(1).dropRight(1)
        } else item
      }
    }
  }

  def escapeLiteral(aString: String): String = {
    // Ported from PostgreSQL 9.2.4 source code in src/interfaces/libpq/fe-exec.c
    var hasBackslash = false
    val escaped = new StringBuffer("'")

    aString.foreach { c =>
      if (c == '\'') {
        escaped.append(c).append(c)
      } else if (c == '\\') {
        escaped.append(c).append(c)
        hasBackslash = true
      } else {
        escaped.append(c)
      }
    }
    escaped.append('\'')

    if (hasBackslash) {
      "E" + escaped.toString
    } else {
      escaped.toString
    }
  }

  def writeEscapedTuple(seq: List[String]): String =
    "(" + seq.map(escapeLiteral).mkString(", ") + ")"

  def sanitize(aString: String): String = aString.replaceAll("'", "")

  // escape ' by doubling it, escape " with backslash, drop commas
  def sanitizeInArrayTuple(aString: String): String =
    aString.replaceAll("'", """''""").replaceAll(""""""", """\\"""").replaceAll(""",""", "")

  def desanitizeFromArrayTuple(aString: String): String =
    aString.replaceAll("""\\"""", """"""").replaceAll("""\\,""", ",")

  def optionLiteral(aStringOpt: Option[String]): String = aStringOpt match {
    case Some(aString) => "'" + aString + "'"
    case None          => "null"
  }

  def optionLiteralSanitized(aStringOpt: Option[String]): String = optionLiteral(aStringOpt.map(sanitize))

}

abstract class SecuredSQLDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SimpleSQLDAO(sqlClient) {
  def collectionName: String
  def existingCollectionName: String = collectionName + "_"

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
          sql"select _id from #$existingCollectionName where _id = ${id.id} and #${updateAccessQ(userId)}"
            .as[String]) ?~> "Failed to check write access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "No update access."
      } yield ()
    }

  def assertDeleteAccess(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] =
    if (ctx.globalAccess) Fox.successful(())
    else {
      for {
        userId <- userIdFromCtx
        resultList <- run(
          sql"select _id from #$existingCollectionName where _id = ${id.id} and #${deleteAccessQ(userId)}"
            .as[String]) ?~> "Failed to check delete access. Does the object exist?"
        _ <- resultList.headOption.toFox ?~> "No delete access."
      } yield ()
    }

  def userIdFromCtx(implicit ctx: DBAccessContext): Fox[ObjectId] =
    ctx.data match {
      case Some(user: User) => Fox.successful(user._id)
      case Some(userSharingTokenContainer: UserSharingTokenContainer) =>
        Fox.successful(userSharingTokenContainer.user._id)
      case _ => Fox.failure("Access denied.")
    }

  def accessQueryFromAccessQWithPrefix(accessQ: (ObjectId, String) => String, prefix: String)(
      implicit ctx: DBAccessContext): Fox[String] =
    if (ctx.globalAccess) Fox.successful("true")
    else {
      for {
        userIdBox <- userIdFromCtx.futureBox
      } yield {
        userIdBox match {
          case Full(userId) => "(" + accessQ(userId, prefix) + ")"
          case _            => "(false)"
        }
      }
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
  def collectionName: String =
    collection.shaped.value.schemaName.map(_ + ".").getOrElse("") + collection.shaped.value.tableName

  def columnsList: List[String] = collection.baseTableRow.create_*.map(_.name).toList
  def columns: String = columnsList.mkString(", ")
  def columnsWithPrefix(prefix: String): String = columnsList.map(prefix + _).mkString(", ")

  def idColumn(x: X): Rep[String]
  def isDeletedColumn(x: X): Rep[Boolean]

  def notdel(r: X): Rep[Boolean] = isDeletedColumn(r) === false

  def parse(row: X#TableElementType): Fox[C]

  def parseFirst(rowSeq: Seq[X#TableElementType], queryLabel: ObjectId): Fox[C] =
    parseFirst(rowSeq, queryLabel.toString)

  def parseFirst(rowSeq: Seq[X#TableElementType], queryLabel: String): Fox[C] =
    for {
      firstRow <- rowSeq.headOption.toFox // No error chain here, as this should stay Fox.Empty
      parsed <- parse(firstRow) ?~> s"Parsing failed for row in $collectionName queried by $queryLabel"
    } yield parsed

  def parseAll(rowSeq: Seq[X#TableElementType]): Fox[List[C]] =
    Fox.combined(rowSeq.toList.map(parse)) ?~> s"Parsing failed for a row in $collectionName during list query"

  @nowarn // suppress warning about unused implicit ctx, as it is used in subclasses
  def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[C] =
    run(collection.filter(r => isDeletedColumn(r) === false && idColumn(r) === id.id).result.headOption).map {
      case Some(r) =>
        parse(r) ?~> ("sql: could not parse database row for object" + id)
      case _ =>
        Fox.failure("sql: could not find object " + id)
    }.flatten

  @nowarn // suppress warning about unused implicit ctx, as it is used in subclasses
  def findAll(implicit ctx: DBAccessContext): Fox[List[C]] =
    for {
      r <- run(collection.filter(row => notdel(row)).result)
      parsed <- Fox.combined(r.toList.map(parse))
    } yield parsed

  def deleteOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield isDeletedColumn(row)
    for {
      _ <- assertDeleteAccess(id)
      _ <- run(q.update(true))
    } yield ()
  }

  def updateStringCol(id: ObjectId, column: X => Rep[String], newValue: String)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateObjectIdCol(id: ObjectId, column: X => Rep[String], newValue: ObjectId)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    updateStringCol(id, column, newValue.id)

  def updateBooleanCol(id: ObjectId, column: X => Rep[Boolean], newValue: Boolean)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue))
    } yield ()
  }

  def updateTimestampCol(id: ObjectId, column: X => Rep[java.sql.Timestamp], newValue: Instant)(
      implicit ctx: DBAccessContext): Fox[Unit] = {
    val q = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(q.update(newValue.toSql))
    } yield ()
  }

}
