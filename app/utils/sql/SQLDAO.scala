package utils.sql

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import slick.jdbc.GetResult
import slick.lifted.{AbstractTable, Rep, TableQuery}

import javax.inject.Inject
import scala.annotation.nowarn
import scala.concurrent.ExecutionContext
import slick.jdbc.PostgresProfile.api._

abstract class SQLDAO[C, R, X <: AbstractTable[R]] @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SecuredSQLDAO(sqlClient) {
  protected def collection: TableQuery[X]
  implicit protected def getResult: GetResult[R]
  override protected def collectionName: String =
    collection.shaped.value.schemaName.map(_ + ".").getOrElse("") + collection.shaped.value.tableName

  protected def columnsList: List[String] = collection.baseTableRow.create_*.map(_.name).toList
  def columns: SqlToken = SqlToken.raw(columnsList.mkString(", "))
  def columnsWithPrefix(prefix: String): SqlToken = SqlToken.raw(columnsList.map(prefix + _).mkString(", "))

  protected def idColumn(x: X): Rep[String]
  protected def isDeletedColumn(x: X): Rep[Boolean]

  protected def notdel(r: X): Rep[Boolean] = isDeletedColumn(r) === false

  protected def parse(row: R): Fox[C]

  protected def parseFirst(rowSeq: Seq[R], queryLabel: ObjectId): Fox[C] =
    parseFirst(rowSeq, queryLabel.toString)

  protected def parseFirst(rowSeq: Seq[R], queryLabel: String): Fox[C] =
    for {
      firstRow <- rowSeq.headOption.toFox // No error chain here, as this should stay Fox.Empty
      parsed <- parse(firstRow) ?~> s"Parsing failed for row in $collectionName queried by $queryLabel"
    } yield parsed

  protected def parseAll(rowSeq: Seq[R]): Fox[List[C]] =
    Fox.combined(rowSeq.toList.map(parse)) ?~> s"Parsing failed for a row in $collectionName during list query"

  @nowarn // suppress warning about unused implicit ctx, as it is used in subclasses
  def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[C] =
    for {
      rows <- run(q"SELECT $columns FROM $existingCollectionName WHERE _id = $id".as[R])
      parsed <- parseFirst(rows, "id")
    } yield parsed

  @nowarn // suppress warning about unused implicit ctx, as it is used in subclasses
  def findAll(implicit ctx: DBAccessContext): Fox[List[C]] =
    for {
      r <- run(q"SELECT $columns FROM $existingCollectionName".as[R])
      parsed <- parseAll(r)
    } yield parsed

  def deleteOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Unit] = {
    val query = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield isDeletedColumn(row)
    for {
      _ <- assertDeleteAccess(id)
      _ <- run(query.update(true))
    } yield ()
  }

  def deleteOneWithNameSuffix(id: ObjectId, nameColumn: String = "name")(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertDeleteAccess(id)
      deletedSuffix = s".deleted.at.${Instant.now.epochMillis}"
      collectionToken = SqlToken.raw(collectionName)
      nameColumnToken = SqlToken.raw(nameColumn)
      _ <- run(
        q"UPDATE $collectionToken SET isDeleted = TRUE, $nameColumnToken = CONCAT($nameColumnToken, $deletedSuffix) WHERE _id = $id".asUpdate
      )
    } yield ()

  protected def updateStringCol(id: ObjectId, column: X => Rep[String], newValue: String)(implicit
      ctx: DBAccessContext
  ): Fox[Unit] = {
    val query = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(query.update(newValue))
    } yield ()
  }

  protected def updateObjectIdCol(id: ObjectId, column: X => Rep[String], newValue: ObjectId)(implicit
      ctx: DBAccessContext
  ): Fox[Unit] =
    updateStringCol(id, column, newValue.id)

  protected def updateBooleanCol(id: ObjectId, column: X => Rep[Boolean], newValue: Boolean)(implicit
      ctx: DBAccessContext
  ): Fox[Unit] = {
    val query = for { row <- collection if notdel(row) && idColumn(row) === id.id } yield column(row)
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(query.update(newValue))
    } yield ()
  }

}
