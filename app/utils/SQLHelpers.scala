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
  override def toString = id
}

object ObjectId {
  implicit val jsonFormat = Json.format[ObjectId]
  def fromBsonId(bson: BSONObjectID) = ObjectId(bson.stringify)
}

object SQLClient {
  lazy val db = Database.forConfig("postgres")
}

trait SQLDAO[C, R, X <: AbstractTable[R]] extends FoxImplicits {
  val db = SQLClient.db

  def collection: TableQuery[X]

  def idColumn(x: X): Rep[String]
  def isDeletedColumn(x: X): Rep[Boolean]

  def notdel(r: X) = isDeletedColumn(r) === false

  def parse(row: X#TableElementType): Fox[C]

  def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[C] = {
    db.run(collection.filter(r => isDeletedColumn(r) === false && idColumn(r) === id.id).result.headOption).map {
      case Some(r) =>
        parse(r) ?~> ("sql: could not parse database row for object" + id)
      case _ =>
        Fox.failure("sql: could not find object " + id)
    }.flatten
  }

  def setStringCol(id: ObjectId, column: (X) => Rep[String], newValue: String): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) == id.id)} yield column(row)
    for {_ <- db.run(q.update(newValue))} yield ()
  }

  def setObjectIdCol(id: ObjectId, column: (X) => Rep[String], newValue: ObjectId) = setStringCol(id, column, newValue.id)

  def setLongCol(id: ObjectId, column: (X) => Rep[Long], newValue: Long): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) == id.id)} yield column(row)
    for {_ <- db.run(q.update(newValue))} yield ()
  }

  def setBooleanCol(id: ObjectId, column: (X) => Rep[Boolean], newValue: Boolean): Fox[Unit] = {
    val q = for {row <- collection if (notdel(row) && idColumn(row) == id.id)} yield column(row)
    for {_ <- db.run(q.update(newValue))} yield ()
  }

  def writeArrayTuple(elements: List[String]): String = {
    val commaSeparated = elements.mkString(",")
    s"{$commaSeparated}"
  }

  def parseArrayTuple(literal: String): List[String] = {
    //TODO: error handling, escape handling. copy from js parser?
    val trimmed = literal.drop(1).dropRight(1)
    if (trimmed.isEmpty) List()
    else trimmed.split(",", -1).toList
  }

  def sanitize(aString: String) = aString // TODO: prevent sql injection
}
