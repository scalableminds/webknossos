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
  
  def testGridFS = Action{

    //Iterate over Block 5/10/10
    
    var differences = 0
    var bytesRead = 0
    
    for{x <- 5*128 until 6*128
    	y <- 10*128 until 11*128
    	z <- 15*256 until 16*256 by 2}{
    	  val FileStoreByte = FileDataStore.load((x,y,z))
    	  val GridFileStoreByte = GridFileDataStore.load((x,y,z))
    	  bytesRead += 1
    	  if(FileStoreByte != GridFileStoreByte){
    	    differences += 1
    	  }  
    }
    Ok("done with %d differences, %d bytes read".format(differences, bytesRead))
  }
}

