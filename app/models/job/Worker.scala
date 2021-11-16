package models.job

import utils.ObjectId

case class Worker(_id: ObjectId,
                  _dataStore: ObjectId,
                  url: String,
                  key: String,
                  maxParallelJobs: Int,
                  created: Long = System.currentTimeMillis,
                  isDeleted: Boolean = false)
