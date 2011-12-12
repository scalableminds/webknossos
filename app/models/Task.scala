package models

import java.util.{Date}

import play.api.Play.current

import com.mongodb.casbah.Imports._
import com.novus.salat.global._
import com.novus.salat.dao.SalatDAO

case class Task(folder: String, project_id: ObjectId, title: String, done: Boolean, dueDate: Option[Date], assignedTo: Option[ObjectId], _id : ObjectId = new ObjectId)

object Task extends BasicDAO[Task]("tasks"){
  /**
   * Retrieve a Task from the id.
   */
  def findById(id: String) = findOneByID(new ObjectId(id))
  
  /**
   * Retrieve todo tasks for the user.
   */
  def findTodoInvolving(email: String): Seq[(Task,Project)] = {
    val user = User.findByEmail(email).get
    val projects = Project.findInvolving(email)
    projects.flatMap( p => {
      Task.find(MongoDBObject("done" -> false, "project_id" -> p._id)).map( t => t -> p)
    })
  }
  
  /**
   * Find tasks related to a project
   */
  def findByProject(projectId: String) = Task.find(MongoDBObject("project_id" -> new ObjectId(projectId))).toList

  /**
   * Delete a task
   */
  def delete(id: String) {
    remove(MongoDBObject("_id" -> new ObjectId(id)))
  }
  
  /**
   * Delete all task in a folder.
   */
  def deleteInFolder(projectId: String, folder: String) {
    remove(MongoDBObject("project_id" -> new ObjectId(projectId), "folder" -> folder))
  }
  
  /**
   * Mark a task as done or not
   */
  def markAsDone(taskId: String, done: Boolean) {
    update(
      MongoDBObject("_id" -> new ObjectId(taskId)),
      MongoDBObject("done" -> done)
    )
  }
  
  /**
   * Rename a folder.
   */
  def renameFolder(projectId: String, folder: String, newName: String) {
    update(
      MongoDBObject("project_id" -> new ObjectId(projectId), "folder" -> folder),
      MongoDBObject("folder" -> newName)
    )
  }
  
  /**
   * Check if a user is the owner of this task
   */
  def isOwner(taskId: String, email: String): Boolean = {
    val user = User.findByEmail(email).get
    

    val projects = Project.findInvolving(email)
    projects.filter( p => findOne(MongoDBObject("_id" -> new ObjectId(taskId), "project_id" -> p._id)) match { case Some(_) => true case _ => false}).size > 0
  }

  /**
   * Create a Task.
   */
  def create(task: Task): Task = {
    insert(task)
    task
  }
  
}