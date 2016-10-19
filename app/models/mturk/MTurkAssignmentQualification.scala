package models.mturk

import play.api.libs.json.{JsError, _}

/**
  * A restriction on mturk workers. Need to fulfill qualification to get the assignment.
  */
trait MTurkAssignmentQualification {
  def id: String
}

/**
  * Anyone can do the assignment
  */
case object MTurkAllowEveryone extends MTurkAssignmentQualification {
  val id = "mt-everyone"
}

/**
  * Only mturk masters can do the task
  */
case object MTurkAllowMasters extends MTurkAssignmentQualification {
  val id = "mt-expert"
}

/**
  * User can not have more than 10k submitted hites (usually this is not what you want, since this is an upper
  * bound on a users qualification, but it is usefull for tests e.g. to see if the number of completed HITs has
  * an influence on the quality of a completed task)
  */
case object MTurkAllowUpperHitLimit10k extends MTurkAssignmentQualification {
  val id = "mt-max-10k-hits"
}

case object MPIBranchPoint extends MTurkAssignmentQualification {
  val id = "mpi-branchpoint"

  val qualificationId = "30ZBCMCDPH4PPUZ0CZ46JEF8RWI4OH"
}

/**
  * User needs to have done at least 10k HITs before
  */
case object MTurkAllowLowerHitLimit10k extends MTurkAssignmentQualification {
  val id = "mt-min-10k-hits"
}

object MTurkAssignmentQualification {

  val allExperiences: List[MTurkAssignmentQualification] =
    MTurkAllowEveryone :: MTurkAllowMasters :: MTurkAllowUpperHitLimit10k ::
      MTurkAllowLowerHitLimit10k :: MPIBranchPoint :: Nil

  implicit val mturkAssignmentQualificationFormat = new Format[MTurkAssignmentQualification] {
    override def writes(o: MTurkAssignmentQualification): JsValue = {
      JsString(o.id)
    }

    override def reads(json: JsValue): JsResult[MTurkAssignmentQualification] =
      json.asOpt[String].flatMap(s => allExperiences.find(_.id == s)) match {
        case Some(e) => JsSuccess(e)
        case None    => JsError("mturk.qualification.invalid")
      }
  }
}
