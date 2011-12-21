package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import models._
import views._
import play.mvc.Results.Redirect


object Admin extends Controller{
  
  def loadData(x: Int, y: Int, z: Int) = Action { implicit request => 
    BinData.createOrGet(x,y,z)
    Ok("saved x:%d y:%d z:%d".format(x,y,z))
  }
}