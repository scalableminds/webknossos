package models

import play.libs.F.Tuple
import play.api.Play.current
import play.mvc._
import play.api.Play

import org.joda.time.DateTime
import java.io.FileInputStream

import com.mongodb.casbah.Imports._
import scala.collection.JavaConverters._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO
import com.mongodb.casbah.gridfs.Imports._


import brainflight.binary.DataStore

case class BinData(x: Int, y: Int, z: Int, var buffer: Array[Byte], _id : ObjectId = new ObjectId()){
  var is = new FileInputStream(BinData.createFilename(x,y,z))
  buffer = DataStore.inputStreamToByteArray(is)
}

object BinData extends BasicDAO[BinData]("bindata"){
  // binary data id
  val binaryDataID = Play.configuration.getString("binarydata.id") getOrElse("100527_k0563_mag1")
  // binary data Path
  val dataPath = Play.configuration.getString("binarydata.path") getOrElse("/media/Data/binary_data")
  
  def createOrGet(x: Int, y: Int, z: Int) = {
    findByCoordinates(x,y,z) match {
      case None => create(new BinData(x,y,z,new Array[Byte](2097152)))
      case Some(data) => data.asInstanceOf[BinData]
    }
  }
  
  private def create(data: BinData) = {
    insert(data)
    data
  }
  
  def findByCoordinates(x: Int, y: Int, z: Int) = {
    findOne(MongoDBObject(
        "x" -> x,
        "y" -> y,
        "z" -> z))
  }
  
  def createFilename(x: Int, y: Int, z: Int): String = {
	"%s/x%04d/y%04d/z%04d/%s_x%04d_y%04d_z%04d.raw".format(dataPath,x,y,z,binaryDataID,x,y,z) 
  }
  
  def convertCoordinatesToString(x: Int, y: Int, z: Int):String = {
    "%04d%04d%04d".format(x,y,z)
  }
  
  def translateCoordinatesToId(x: Int, y: Int, z: Int):ObjectId = {
   //does not work as expected
   val hexString = (x,y,z).hashCode.toHexString
   val idString = "0"*(24-hexString.size) + hexString
   return new ObjectId(idString)
  }
}

object BinDataGridFs{
  //GridFs handle
  val myfs = GridFS(MongoConnection()(Play.configuration.getString("mongo.dbname").getOrElse("salat-dao")))
  
  def findByCoordinates(x: Int, y: Int, z: Int) =myfs.findOne(BinData.createFilename(x,y,z))

  def create(x: Int, y:Int, z: Int)={   
    val IS = new FileInputStream(BinData.convertCoordinatesToString(x,y,z))
    myfs(IS) { fh=>
    fh.filename = BinData.convertCoordinatesToString(x,y,z)
    fh.contentType = "application"
    }
  }
}