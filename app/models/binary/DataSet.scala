package models.binary

import com.mongodb.casbah.Imports._
import models.context._
import com.novus.salat.annotations._
import com.novus.salat.dao.SalatDAO
import brainflight.tools.geometry.Point3D
import play.api.libs.functional.syntax._
import models.basics.BasicDAO
import models.basics.DAOCaseClass
import play.api.libs.json._
import models.user.User
import models.team.Team

case class BareDataSet(name: String, maxCoordinates: Point3D, priority: Int = 0) {
  def addLayers(baseDir: String,
                colorLayer: ColorLayer,
                segmentationLayers: List[SegmentationLayer] = Nil,
                classificationLayer: Option[ClassificationLayer] = None) = {
    DataSet(name, baseDir, maxCoordinates, priority, colorLayer, List(Team.default.name), segmentationLayers, classificationLayer)
  }

}

object BareDataSet extends Function3[String, Point3D, Int, BareDataSet] {

  implicit val BareDataSetReads: Reads[BareDataSet] = Json.reads[BareDataSet]
}

//TODO: basedir komplett rausziehen und in config definieren
case class DataSet(
    name: String,
    baseDir: String,
    maxCoordinates: Point3D,
    priority: Int = 0,
    colorLayer: ColorLayer,
    allowedTeams: List[String],
    segmentationLayers: List[SegmentationLayer] = Nil,
    classificationLayer: Option[ClassificationLayer] = None,
    _id: ObjectId = new ObjectId) extends DAOCaseClass[DataSet] {

  def dao = UnsecuredDataSet

  val id = _id.toString

  val dataLayers = ((colorLayer :: segmentationLayers)).groupBy(layer => layer.name).mapValues(list => list.head)

  /**
   * Checks if a point is inside the whole data set boundary.
   */
  def doesContain(point: Point3D) =
    point.x >= 0 && point.y >= 0 && point.z >= 0 && // lower bound
      !(point hasGreaterCoordinateAs maxCoordinates)
}

object UnsecuredDataSet extends BasicDAO[DataSet]("dataSets")

object DataSet {

  def default = {
    //find(MongoDBObject())

    val all = UnsecuredDataSet.findAll.filter(_.allowedTeams.contains(Team.default.name))
    if (all.isEmpty)
      throw new Exception("No default data set found!")
    all.maxBy(_.priority)
  }

  def hasAccess(user: User)(dataSet: DataSet) = {
    dataSet.allowedTeams.isEmpty || dataSet.allowedTeams.find(user.teams.contains).isDefined
  }

  def deleteAllExcept(names: Array[String]) = {
    UnsecuredDataSet.removeByIds(UnsecuredDataSet.findAll.filterNot(d => names.contains(d.name)).map(_._id))
  }

  def allAccessible(user: User) = {
    UnsecuredDataSet.findAll.filter(hasAccess(user))
  }

  def findOneById(id: String, user: User) =
    UnsecuredDataSet.findOneById(id).filter(hasAccess(user))

  def findInAllOneByName(name: String) =
    UnsecuredDataSet.findOne(MongoDBObject("name" -> name))

  def findOneByName(name: String, user: User) =
    UnsecuredDataSet.findOne(MongoDBObject("name" -> name)).filter(hasAccess(user))

  def updateOrCreate(d: DataSet) = {
    UnsecuredDataSet.findOne(MongoDBObject("name" -> d.name)) match {
      case Some(stored) =>
        stored.update(_ => d.copy(_id = stored._id, priority = stored.priority, allowedTeams = stored.allowedTeams))
      case _ =>
        UnsecuredDataSet.insertOne(d)
    }
  }

  def removeByName(name: String) {
    UnsecuredDataSet.remove(MongoDBObject("name" -> name))
  }

}