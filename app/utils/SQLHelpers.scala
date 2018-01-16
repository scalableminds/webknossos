/*
 * Copyright (C) 2011-2018 scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package utils


import com.scalableminds.util.reactivemongo.DBAccessContext
import com.scalableminds.util.tools.{Fox, FoxImplicits}
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.json.Json
import reactivemongo.bson.BSONObjectID
import slick.jdbc.PostgresProfile.api._
import slick.lifted.{AbstractTable, Rep, TableQuery}


case class ObjectId(id: String) {
  def toBSONObjectId = BSONObjectID.parse(id).toOption
}

object ObjectId { implicit val jsonFormat = Json.format[ObjectId] }


trait InsertOnlySQLDAO extends FoxImplicits {

}

trait SQLDAO[C, R, X <: AbstractTable[R]] extends FoxImplicits {
  val db = Database.forConfig("postgres")

  def collection: TableQuery[X]

  def idColumn(x: X): Rep[String]
  def isDeletedColumn(x: X): Rep[Boolean]

  def parse(row: X#TableElementType): Fox[C]

  def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[C] = {
    db.run(collection.filter(r => isDeletedColumn(r) === false && idColumn(r) === id.id).result.headOption).map {
      case Some(r) =>
        parse(r) ?~> ("sql: could not parse database row for object" + id)
      case _ =>
        Fox.failure("sql: could not find object " + id)
    }.flatten
  }

  def parseStructTuple(literal: String): List[String] = {
    List(literal)
  }

  def parseArrayTuple(literal: String): List[String] = {
    //TODO: error handling, escape handling. copy from js parser?
    val trimmed = literal.drop(1).dropRight(1)
    if (trimmed.isEmpty) List()
    else trimmed.split(",", -1).toList
  }
}
