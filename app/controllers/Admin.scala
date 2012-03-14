package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import play.mvc.Results.Redirect
import play.Logger
import java.text.SimpleDateFormat
import java.util.TimeZone
import brainflight.binary.{FileDataStore,GridFileDataStore}
import java.io.{ FileNotFoundException, InputStream, FileInputStream, File }
import com.mongodb.casbah.Imports._
import com.mongodb.casbah.gridfs.Imports._

object Admin extends Controller{
  
  def timeGridFS(xBot: Int, xTop: Int, yBot: Int, yTop: Int, zBot: Int, zTop: Int) = Action{
    
    var gridFileDataStoreTime = -System.currentTimeMillis()
    for{
        x <- xBot until xTop
    	y <- yBot until yTop
    	z <- zBot until zTop}
    {
      GridFileDataStore.load(Tuple3(x*128,y*128,z*256))
    }
    gridFileDataStoreTime += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    GridFileDataStore.cleanUp()
    Ok("GridFS needed %s".format(sdf.format(gridFileDataStoreTime)))
  }
  
  def timeFileDataStore(xBot: Int, xTop: Int, yBot: Int, yTop: Int, zBot: Int, zTop: Int) = Action{
    var fileDataStoreTime = -System.currentTimeMillis()
    for{
        x <- 0 until 30
    	y <- 0 until 30
    	z <- 0 until 30}
    {
      FileDataStore.load(Tuple3(x*128,y*128,z*256))
    }
    fileDataStoreTime += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    FileDataStore.cleanUp()
    Ok("FileDataStore needed %s".format(sdf.format(fileDataStoreTime)))
  }
    
  /*
  def testGridFS = Action{
    
    var fileDataStoreTime = -System.currentTimeMillis()
    for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 15*256 until 16*256 by 2}
    {
      FileDataStore.load(Tuple3(x,y,z))
    }
    fileDataStoreTime += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    Logger.info("FileDatastore needed: %s".format(sdf.format(fileDataStoreTime)))
    
    var gridFileDataStoreTime = -System.currentTimeMillis()
    for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 15*256 until 16*256 by 2}
    {
      GridFileDataStore.load(Tuple3(x,y,z))
    }
    gridFileDataStoreTime += System.currentTimeMillis()
    Logger.info("GridFileDatastore needed: %s".format(sdf.format(gridFileDataStoreTime)))
    Ok("done")
  }*/
}


