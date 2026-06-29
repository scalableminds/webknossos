package utils.sql

import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import slick.jdbc.GetResult
import slick.lifted.{AbstractTable, TableQuery}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

abstract class SQLDAO[C, R, X <: AbstractTable[R]] @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SecuredSQLDAO(sqlClient) {
  protected def collection: TableQuery[X]
  override protected def collectionName: SqlToken =
    SqlToken.raw(collection.shaped.value.schemaName.map(_ + ".").getOrElse("") + collection.shaped.value.tableName)

  protected def columnsList: List[String] = collection.baseTableRow.create_*.map(_.name).toList
  def columns: SqlToken = SqlToken.raw(columnsList.mkString(", "))
  def columnsWithPrefix(prefix: String): SqlToken = SqlToken.raw(columnsList.map(prefix + _).mkString(", "))

  protected def resultConverter: GetResult[R]

  protected def parse(row: R): Fox[C]

  protected def parseFirst(rowSeq: Seq[R], queryLabel: ObjectId): Fox[C] =
    parseFirst(rowSeq, queryLabel.toString)

  protected def parseFirst(rowSeq: Seq[R], queryLabel: String): Fox[C] =
    for {
      firstRow <- rowSeq.headOption.toFox // No error chain here, as this should stay Fox.Empty
      parsed <- parse(firstRow) ?~> s"Parsing failed for row in $collectionName queried by $queryLabel"
    } yield parsed

  protected def parseAll(rowSeq: Seq[R]): Fox[List[C]] =
    Fox.combined(rowSeq.map(parse)) ?~> s"Parsing failed for a row in $collectionName during list query"

  def findOne(id: ObjectId)(using ctx: DBAccessContext): Fox[C] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _id = $id AND $accessQuery".as[R](using resultConverter)
      )
      parsed <- parseFirst(r, id)
    } yield parsed

  def findAll(using ctx: DBAccessContext): Fox[List[C]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM $existingCollectionName WHERE $accessQuery".as[R](using resultConverter))
      parsed <- parseAll(r)
    } yield parsed

  def deleteOne(id: ObjectId)(using ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertDeleteAccess(id)
      _ <- run(q"UPDATE $collectionName SET isDeleted = TRUE WHERE _id = $id".asUpdate)
    } yield ()

  def deleteOneWithNameSuffix(id: ObjectId, nameColumn: String = "name")(using ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertDeleteAccess(id)
      deletedSuffix = s".deleted.at.${Instant.now.epochMillis}"
      collectionToken = collectionName
      nameColumnToken = SqlToken.raw(nameColumn)
      _ <- run(
        q"UPDATE $collectionToken SET isDeleted = TRUE, $nameColumnToken = CONCAT($nameColumnToken, $deletedSuffix) WHERE _id = $id".asUpdate
      )
    } yield ()

}
