package models.mesh

import com.google.common.io.BaseEncoding
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.geometry.Point3D
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import javax.inject.Inject
import models.annotation.{Annotation, AnnotationState, AnnotationType}
import models.task.Task
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import scala.concurrent.ExecutionContext


case class Mesh(
  _id: ObjectId,
  _annotation: ObjectId,
  description: String,
  position: Point3D,
  data: Array[Byte],
  created: Long = System.currentTimeMillis,
  isDeleted: Boolean = false
)

case class MeshInfo(
  _id: ObjectId,
  _annotation: ObjectId,
  description: String,
  position: Point3D,
)

class MeshDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SQLDAO[Mesh, MeshesRow, Meshes](sqlClient) {
  val collection = Meshes

  def idColumn(x: Meshes): Rep[String] = x._Id

  def isDeletedColumn(x: Meshes): Rep[Boolean] = x.isdeleted

  def parse(r: MeshesRow): Fox[Mesh] =
    for {
      position <- Point3D.fromList(parseArrayTuple(r.position).map(_.toInt)) ?~> "could not parse mesh position"
    } yield {
      Mesh(
        ObjectId(r._Id),
        ObjectId(r._Annotation),
        r.description,
        position,
        BaseEncoding.base64().decode(r.data),
        r.created.getTime,
        r.isdeleted
      )
    }

  def parseInfo(r: (String, String, String, String)): Fox[MeshInfo] = {
    for {
      position <- Point3D.fromList(parseArrayTuple(r._4).map(_.toInt)) ?~> "could not parse mesh position"
    } yield MeshInfo(ObjectId(r._1), ObjectId(r._2), r._3, position)
  }

  override def findOne(id: ObjectId)(implicit ctx: DBAccessContext): Fox[Mesh] =
    for {
      accessQuery <- readAccessQuery
      rList <- run(sql"select #${columns} from #${existingCollectionName} where _id = ${id.id} and #${accessQuery}".as[MeshesRow])
      r <- rList.headOption.toFox ?~> ("Could not find object " + id + " in " + collectionName)
      parsed <- parse(r) ?~> ("SQLDAO Error: Could not parse database row for object " + id + " in " + collectionName)
    } yield parsed

  def infoForAllWithAnnotation(_annotation: ObjectId)(implicit ctx: DBAccessContext): Fox[List[MeshInfo]] = {
    for {
      accessQuery <- readAccessQuery
      resultTuples <- run(sql"select _id, _annotation, description, position from #${existingCollectionName} where _annotation = ${_annotation}"
        .as[(String, String, String, String)])
      resultsParsed <- Fox.serialCombined(resultTuples.toList)(parseInfo)
    } yield resultsParsed
  }

  def insertOne(m: Mesh)(implicit ctx: DBAccessContext): Fox[Unit] = {
    for {
      _ <- run(
        sqlu"""insert into webknossos.meshes(_id, _annotation, description, position, data, created, isDeleted)
                   values(${m._id.id}, ${m._annotation.id}, ${m.description}, '#${writeStructTuple(m.position.toList.map(_.toString))}',
                          ${BaseEncoding.base64().encode(m.data)}, ${new java.sql.Timestamp(m.created)}, ${m.isDeleted})
        """)
    } yield ()
  }
}
