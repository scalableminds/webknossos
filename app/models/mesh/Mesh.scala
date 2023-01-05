package models.mesh

import com.google.common.io.BaseEncoding
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.Vec3Int
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._

import javax.inject.Inject
import play.api.libs.json.Json._
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.sql.{SqlClient, SQLDAO}
import utils.ObjectId

import scala.concurrent.ExecutionContext

case class MeshInfo(
    _id: ObjectId,
    _annotation: ObjectId,
    description: String,
    position: Vec3Int,
    created: Instant = Instant.now,
    isDeleted: Boolean = false
)

case class MeshInfoParameters(
    annotationId: ObjectId,
    description: String,
    position: Vec3Int,
)
object MeshInfoParameters {
  implicit val jsonFormat: OFormat[MeshInfoParameters] = Json.format[MeshInfoParameters]
}

class MeshService @Inject()()(implicit ec: ExecutionContext) {
  def publicWrites(meshInfo: MeshInfo): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> meshInfo._id.toString,
        "annotationId" -> meshInfo._annotation.toString,
        "description" -> meshInfo.description,
        "position" -> meshInfo.position
      ))

  def compactWrites(meshInfo: MeshInfo): Fox[JsObject] =
    Fox.successful(
      Json.obj(
        "id" -> meshInfo._id.toString,
        "description" -> meshInfo.description,
        "position" -> meshInfo.position
      ))
}

class MeshDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[MeshInfo, MeshesRow, Meshes](sqlClient) {
  protected val collection = Meshes

  protected def idColumn(x: Meshes): Rep[String] = x._Id

  protected def isDeletedColumn(x: Meshes): Rep[Boolean] = x.isdeleted

  private val infoColumns = (columnsList diff Seq("data")).mkString(", ")
  type InfoTuple = (ObjectId, ObjectId, String, String, Instant, Boolean)

  override protected def parse(r: MeshesRow): Fox[MeshInfo] =
    Fox.failure("not implemented, use parseInfo or get the data directly")

  private def parseInfo(r: InfoTuple): Fox[MeshInfo] =
    for {
      position <- Vec3Int.fromList(parseArrayTuple(r._4).map(_.toInt)) ?~> "could not parse mesh position"
    } yield {
      MeshInfo(
        r._1, //_id
        r._2, //_annotation
        r._3, // description
        position,
        r._5, //created
        r._6 //isDeleted
      )
    }

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[MeshInfo] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(
        sql"select #$infoColumns from #$existingCollectionName where _id = ${id.id} and #$accessQuery".as[InfoTuple])
      r <- rList.headOption.toFox
      parsed <- parseInfo(r)
    } yield parsed

  def findAllWithAnnotation(_annotation: ObjectId)(implicit ctx: DBAccessContext): Fox[List[MeshInfo]] =
    for {
      accessQuery <- readAccessQuery
      resultTuples <- run(
        sql"select #$infoColumns from #$existingCollectionName where _annotation = ${_annotation} and #$accessQuery"
          .as[InfoTuple])
      resultsParsed <- Fox.serialCombined(resultTuples.toList)(parseInfo)
    } yield resultsParsed

  def insertOne(m: MeshInfo): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.meshes(_id, _annotation, description, position, created, isDeleted)
                   values(${m._id.id}, ${m._annotation.id}, ${m.description}, '#${writeStructTuple(
        m.position.toList.map(_.toString))}',
                          ${m.created}, ${m.isDeleted})
        """)
    } yield ()

  def updateOne(id: ObjectId, _annotation: ObjectId, description: String, position: Vec3Int)(
      implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"""update webknossos.meshes set _annotation = ${_annotation}, description = $description,
                            position = '#${writeStructTuple(position.toList.map(_.toString))}' where _id = $id""")
    } yield ()

  def getData(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Array[Byte]] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select data from webknossos.meshes where _id = $id and #$accessQuery".as[Option[String]])
      r <- rList.headOption.flatten.toFox
      binary = BaseEncoding.base64().decode(r)
    } yield binary

  def updateData(id: ObjectId, data: Array[Byte])(implicit ctx: DBAccessContext): Fox[Unit] =
    for {
      _ <- assertUpdateAccess(id)
      _ <- run(sqlu"update webknossos.meshes set data = ${BaseEncoding.base64().encode(data)} where _id = $id")
    } yield ()

}
