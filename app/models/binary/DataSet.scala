package models.binary

import com.scalableminds.braingames.binary.models.DataSource
import com.scalableminds.util.geometry.{Point3D, Vector3D}
import com.scalableminds.util.reactivemongo.AccessRestrictions.AllowIf
import com.scalableminds.util.reactivemongo.{DBAccessContext, DefaultAccessDefinitions}
import models.basics._
import models.user.User
import play.api.libs.concurrent.Execution.Implicits._
import com.scalableminds.util.reactivemongo.AccessRestrictions.AllowIf
import com.scalableminds.braingames.binary.models.{DataLayer, DataSource}
import com.scalableminds.util.geometry.{BoundingBox, Point3D, Scale, Vector3D}
import models.annotation.AnnotationDAO._
import models.configuration.DataSetConfiguration
import play.api.libs.functional.syntax._
import play.api.libs.json._
import play.utils.UriEncoding
import reactivemongo.api.indexes.{Index, IndexType}

case class DataSet(
  name: String,
  dataStoreInfo: DataStoreInfo,
  dataSource: Option[DataSource],
  sourceType: String,
  owningTeam: String,
  allowedTeams: List[String],
  isActive: Boolean = false,
  isPublic: Boolean = false,
  accessToken: Option[String],
  description: Option[String] = None,
  defaultConfiguration: Option[DataSetConfiguration] = None,
  created: Long = System.currentTimeMillis()) {

  def urlEncodedName: String =
    UriEncoding.encodePathSegment(name, "UTF-8")

  def isEditableBy(user: Option[User]) =
    user.exists(_.isAdminOf(owningTeam))

  def defaultStart =
    dataSource.map(_.boundingBox.center).getOrElse(Point3D(0, 0, 0))

  def defaultRotation =
    Vector3D(0, 0, 0)
}

object DataSet {
  implicit val dataSetFormat = Json.format[DataSet]

  def dataSetPublicWrites(user: Option[User]): Writes[DataSet] =
    ((__ \ 'name).write[String] and
      (__ \ 'dataSource).write[Option[DataSource]] and
      (__ \ 'dataStore).write[DataStoreInfo] and
      (__ \ 'sourceType).write[String] and
      (__ \ 'owningTeam).write[String] and
      (__ \ 'allowedTeams).write[List[String]] and
      (__ \ 'isActive).write[Boolean] and
      (__ \ 'accessToken).write[Option[String]] and
      (__ \ 'isPublic).write[Boolean] and
      (__ \ 'description).write[Option[String]] and
      (__ \ 'created).write[Long] and
      (__ \ "isEditable").write[Boolean]) (d =>
      (d.name, d.dataSource, d.dataStoreInfo, d.sourceType, d.owningTeam, d.allowedTeams, d.isActive, d.accessToken, d.isPublic, d.description, d.created, d.isEditableBy(user)))
}

object DataSetDAO extends SecuredBaseDAO[DataSet] {
  
  val collectionName = "dataSets"

  val formatter = DataSet.dataSetFormat

  underlying.indexesManager.ensure(Index(Seq("name" -> IndexType.Ascending)))

  // Security
  override val AccessDefinitions = new DefaultAccessDefinitions {
    override def findQueryFilter(implicit ctx: DBAccessContext) = {
      ctx.data match {
        case Some(user: User) =>
          AllowIf(
            Json.obj("$or" -> Json.arr(
              Json.obj("isPublic" -> true),
              Json.obj("allowedTeams" -> Json.obj("$in" -> user.teamNames)),
              Json.obj("owningTeam" -> Json.obj("$in" -> user.adminTeamNames))
            )))
        case _                =>
          AllowIf(
            Json.obj("isPublic" -> true)
          )
      }
    }
  }
  
  def byNameQ(name: String) =
    Json.obj("name" -> name)

  def default()(implicit ctx: DBAccessContext) =
    findMaxBy("priority")

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext) =
    findOne(byNameQ(name))

  def updateDataSource(
    name: String,
    dataStoreInfo: DataStoreInfo,
    source: Option[DataSource],
    isActive: Boolean)(implicit ctx: DBAccessContext) = {
    update(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "dataStoreInfo" -> dataStoreInfo,
        "isActive" -> isActive,
        "dataSource" -> source
      ))
    )
  }

  def updateTeams(name: String, teams: List[String])(implicit ctx: DBAccessContext) =
    update(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "allowedTeams" -> teams)))
}
