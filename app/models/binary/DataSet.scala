package models.binary

import play.api.libs.functional.syntax._
import models.basics._
import play.api.libs.json._
import models.user.User
import com.scalableminds.util.reactivemongo.{DefaultAccessDefinitions, DBAccessContext}
import play.api.libs.concurrent.Execution.Implicits._
import scala.Some
import com.scalableminds.util.reactivemongo.AccessRestrictions.AllowIf
import com.scalableminds.braingames.binary.models.DataSource
import com.scalableminds.util.geometry.Point3D
import play.utils.UriEncoding

case class DataSet(
                    name: String,
                    dataStoreInfo: DataStoreInfo,
                    dataSource: Option[DataSource],
                    sourceType: String,
                    owningTeam: String,
                    allowedTeams: List[String],
                    isActive: Boolean = false,
                    isPublic: Boolean = false,
                    description: Option[String] = None,
                    created: Long = System.currentTimeMillis()) {

  def urlEncodedName: String =
    UriEncoding.encodePathSegment(name, "UTF-8")

  def isEditableBy(user: Option[User]) =
    user.map(_.adminTeamNames.contains(owningTeam)) getOrElse false

  def defaultStart =
    dataSource.map(_.boundingBox.center).getOrElse(Point3D(0, 0, 0))
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
      (__ \ 'isPublic).write[Boolean] and
      (__ \ 'description).write[Option[String]] and
      (__ \ 'created).write[Long] and
      (__ \ "isEditable").write[Boolean])(d =>
    (d.name, d.dataSource, d.dataStoreInfo, d.sourceType, d.owningTeam, d.allowedTeams, d.isActive, d.isPublic, d.description, d.created, d.isEditableBy(user)))
}

object DataSetDAO extends SecuredBaseDAO[DataSet] {
  val collectionName = "dataSets"

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
        case _ =>
          AllowIf(
            Json.obj("isPublic" -> true)
          )
      }
    }
  }

  import com.scalableminds.braingames.binary.models.DataLayer.dataLayerFormat

  val formatter = DataSet.dataSetFormat

  def byNameQ(name: String) =
    Json.obj("name" -> name)

  def default()(implicit ctx: DBAccessContext) =
    findMaxBy("priority")

  def deleteAllSourcesExcept(names: Array[String])(implicit ctx: DBAccessContext) =
    remove(Json.obj("name" -> Json.obj("$nin" -> names)))

  def findOneBySourceName(name: String)(implicit ctx: DBAccessContext) =
    findOne(byNameQ(name))

  def findAllOwnedBy(teams: List[String])(implicit ctx: DBAccessContext) =
    find(Json.obj("owningTeam" -> Json.obj("$in" -> teams))).cursor[DataSet].collect[List]()

  def findAllActive(implicit ctx: DBAccessContext) = withExceptionCatcher{
    find(Json.obj("isActive" -> true)).cursor[DataSet].collect[List]()
  }

  def updateDataSource(name: String, dataStoreInfo: DataStoreInfo, dataSource: DataSource)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("name" -> name),
      Json.obj("$set" -> Json.obj(
        "dataStoreInfo" -> dataStoreInfo,
        "isActive" -> true,
        "dataSource" -> dataSource
      ))
    )

  def updateActiveState(name: String, isActive: Boolean)(implicit ctx: DBAccessContext) =
    update(
      Json.obj("name" -> name),
      Json.obj("$set" -> Json.obj(
        "isActive" -> isActive
      )))

  def removeByName(name: String)(implicit ctx: DBAccessContext) =
    remove(Json.obj("name" -> name))

  def removeBySourceId(names: List[String])(implicit ctx: DBAccessContext) =
    remove(Json.obj("dataSource.id" -> Json.obj("$in" -> names)))

  def formatWithoutId(ds: DataSource) = {
    val js = Json.toJson(ds)
    js.transform(removeId).getOrElse {
      System.err.println("Couldn't remove ID from: " + js)
      js
    }
  }

  def updateTeams(name: String, teams: List[String])(implicit ctx: DBAccessContext) =
    update(
      byNameQ(name),
      Json.obj("$set" -> Json.obj(
        "allowedTeams" -> teams)))
}
