package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import models._
import views._
import play.mvc.Results.Redirect
import java.text.SimpleDateFormat
import java.util.TimeZone
import scala.collection.mutable.HashMap
import brainflight.binary.DataStore
import brainflight.binary.FileDataStore

object Admin extends Controller{
  val fileDataStore = FileDataStore
  
  
  def loadData(x: Int, y: Int, z: Int) = Action { implicit request => 
    BinData.createOrGet(x,y,z)
    Ok("saved x:%d y:%d z:%d".format(x,y,z))
  }
  
  def fullTest() = Action{
    Ok("BinData: %s\n GridFS: %s\n DataStore: %s\n".format(timeBinDoc(),
        timeGridFS(),timeDataStore()))
  }
  
  def createTestBinData()= Action{
    val x = 5
    BinData.collection.dropCollection()
    for{y <- 0 until 25
    	z <- 0 until 20}{
    	  BinData.createOrGet(x,y,z)
    }
    Ok("BinData Database created")
  }
  
  def createGridFsData() = Action{
    val x = 5
    for{y <- 0 until 25
    	z <- 0 until 20}{
    	  Logger.info("processing %d %d %d".format(x,y,z))
    	  BinDataGridFs.createOrGet(x,y,z)
    	}
    Ok("Gridfs Database created")
  }
  
  def timeBinDoc() = {
    val x = 5
    var time = -System.currentTimeMillis()
    val fileBuffer = new HashMap[Tuple3[Int, Int, Int], Array[Byte]]

    for{y <- 0 until 25
        z <- 0 until 20}{
          BinData.findByCoordinates(x,y,z) match {
            case Some(data) => fileBuffer += (((x,y,z),data.buffer))
            case None => println("this will not happen")
          }
        }
    time += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    fileBuffer.clear()
    sdf.format(time)
  }
  
  def testBinDoc() = Action {
	Ok(timeBinDoc())
  }
  
  def timeGridFS()={
    val x = 5
    var fileBuffer = new HashMap[Tuple3[Int, Int, Int], Array[Byte]]
	
    var time = -System.currentTimeMillis()
    for{y <- 0 until 25
    	z <- 0 until 20}{
    	  BinDataGridFs.findByCoordinates(x,y,z) match {
    	    case Some(data) => fileBuffer += (((x,y,z),fileDataStore.inputStreamToByteArray(data.inputStream)))
            case None => println("this will not happen")
    	  }
    	}
    time += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    fileBuffer.clear()
    sdf.format(time)
  }
  
  def testGridFS() = Action {
    Ok(timeGridFS()) 
  }
  
  def cleanup() = Action {
    System.runFinalization()
    System.gc()
    Ok("cleaned up!")
  }
  
  def timeDataStore() = {
    val x = 5
    var time = -System.currentTimeMillis()
    for{y <- 0 until 25
    	z <- 0 until 20}{
    	  fileDataStore.load(Tuple3(x*128,y*128,z*128))
    	}
    time += System.currentTimeMillis()
    TimeZone.setDefault(TimeZone.getTimeZone("GMT"))
    val sdf = new SimpleDateFormat("HH:mm:ss:SSS")
    fileDataStore.cleanUp()
    sdf.format(time)
  }
  
  def testDataStore() = Action {
	Ok(timeDataStore())
  }
}

