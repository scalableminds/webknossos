package models

import play.api.Play.current

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO

case class Project(folder: String, name: String, _id: ObjectId = new ObjectId)

case class ProjectMember(user_id: ObjectId, project_id: ObjectId, _id: ObjectId = new ObjectId)

object ProjectMember extends BasicDAO[ProjectMember]("projectmembers")

object Project extends BasicDAO[Project]("projects"){
  def findById(id: String) = findOneByID(new ObjectId(id))
  
  /**
   * Retrieve project for user
   */
  def findInvolving(email: String) = {
    val user = User.findByEmail(email).get
    val projects = ProjectMember.find(MongoDBObject("user_id" -> user._id))

    projects.map( pm =>
      findOneByID(pm.project_id).get
    ).toList
  }
  
  /**
   * Update a project.
   */
  def rename(id: String, newName: String) {
    update(
      MongoDBObject("_id" -> new ObjectId(id)),      // find this
      MongoDBObject("name" -> newName)               // write this to found
    )
  }
  
  /**
   * Delete a project.
   */
  def delete(id: String) {
    remove(MongoDBObject("_id" -> new ObjectId(id)))
  }
  
  /**
   * Delete all project in a folder
   */
  def deleteInFolder(folder: String) {
    remove(MongoDBObject("folder" -> folder))
  }
  
  /**
   * Rename a folder
   */
  def renameFolder(folder: String, newName: String) {
    update(
      MongoDBObject("folder" -> folder),      // find this
      MongoDBObject("folder" -> newName)      // write this to found
    )
  }
  
  /**
   * Retrieve project member
   */
  def membersOf(id: String) = {
    val projects = ProjectMember.find(MongoDBObject("project_id" -> id))

    projects.map( pm =>
      User.findOneByID(pm.user_id).get
    ).toList
  }
  
  /**
   * Add a member to the project team.
   */
  def addMember(projectId: String, email: String) {
    val user = User.findByEmail(email).get
    ProjectMember.insert(ProjectMember(user._id,new ObjectId(projectId)))
  }
  
  /**
   * Remove a member from the project team.
   */
  def removeMember(projectId: String, email: String) {
    val user = User.findByEmail(email).get
    ProjectMember.remove(MongoDBObject("user_id"-> user._id , "project_id" -> new ObjectId(projectId)))
  }
  
  /**
   * Check if a user is a member of this project
   */
  def isMember(projectId: String, email: String): Boolean = {
    val user = User.findByEmail(email).get
    ProjectMember.findOne(MongoDBObject("project_id" -> new ObjectId(projectId), "user_id" -> user._id)) match {
      case Some(_) => true
      case _ => false
    }
  }
   
  /**
   * Create a Project.
   */
  def create(project: Project, memberEmails: Seq[String]): Project = {
    insert(project)
     // Add members
     memberEmails.foreach( email =>  {
       val user = User.findByEmail(email).get
       ProjectMember.insert(ProjectMember(user._id,project._id))
     })
     project
  }
  
}