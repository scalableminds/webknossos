package models.mesh

import com.google.common.io.BaseEncoding
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import play.api.libs.functional.syntax._
import play.api.libs.json.Json._
import play.api.libs.json._
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext

case class MeshInfo(
    _id: ObjectId,
    _annotation: ObjectId,
    description: String,
    position: Point3D,
    created: Long = System.currentTimeMillis,
    isDeleted: Boolean = false
)

case class MeshInfoParameters(
    annotationId: ObjectId,
    description: String,
    position: Point3D,
)
object MeshInfoParameters {
  implicit val meshInfoParametersReads: Reads[MeshInfoParameters] =
    ((__ \ "annotationId").read[String](ObjectId.stringObjectIdReads("teamId")) and
      (__ \ "description").read[String] and
      (__ \ "position").read[Point3D])((annotationId, description, position) =>
      MeshInfoParameters(ObjectId(annotationId), description, position))
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

class MeshDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[MeshInfo, MeshesRow, Meshes](sqlClient) {
  val collection = Meshes

  def idColumn(x: Meshes): Rep[String] = x._Id

  def isDeletedColumn(x: Meshes): Rep[Boolean] = x.isdeleted

  private val infoColumns = (columnsList diff Seq("data")).mkString(", ")
  type InfoTuple = (String, String, String, String, java.sql.Timestamp, Boolean)

  override def parse(r: MeshesRow): Fox[MeshInfo] =
    Fox.failure("not implemented, use parseInfo or get the data directly")

  def parseInfo(r: InfoTuple): Fox[MeshInfo] =
    for {
      position <- Point3D.fromList(parseArrayTuple(r._4).map(_.toInt)) ?~> "could not parse mesh position"
    } yield {
      MeshInfo(
        ObjectId(r._1), //_id
        ObjectId(r._2), //_annotation
        r._3, // description
        position,
        r._5.getTime, //created
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
                          ${new java.sql.Timestamp(m.created)}, ${m.isDeleted})
        """)
    } yield ()

  def updateOne(id: ObjectId, _annotation: ObjectId, description: String, position: Point3D)(
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
