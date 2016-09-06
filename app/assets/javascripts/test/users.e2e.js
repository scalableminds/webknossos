import UserPage from "./pages/user_page"
import Request from "./helpers/ajaxDownload"

describe("User List", function() {

  var page

  beforeEach(function() {
    page = new UserPage()
    page.get()
  })

  it("should show all users", async function() {

    const maxUsersPerPage = 50
    const userLisEntries = await page.getUserListEntries()
    const numUserListEntries = Math.min(userLisEntries.length, maxUsersPerPage)

    const url = "/api/users?isEditable=true"
    const users = await Request.json().from(url)
    expect(users.length).toEqual(numUserListEntries)
  })


  it("should assign a new team", function() {

    // create a new team for assignment
    const newTeamName = "test2"
    const payload = {"name": newTeamName,"parent":"Connectomics department","owner":"","roles":[{"name":"admin"},{"name":"user"}],"isEditable":"true"}

    return Request.json().upload("/api/teams", {"data" : payload}).then(
      async function(response) {

        // select first user 'SCM Boy' and switch the role of the newly created
        // team to 'user'
        await page.selectUser("SCM Boy")
        const newTeamRoles = await page.selectTeams([newTeamName])
        await page.clickConfirmButton()

        expect(newTeamRoles[0]).toBe("user")

        // confirm that the user table updated
        const teams = await page.getTeamsForUser("SCM Boy")
        expect(teams).toContain(newTeamName)
    })
  })


  it("should change roles of two teams", function() {
    // TODO
    return false
  })


  it("should assign new experience", async function() {

    const newExperience = {domain : "Testing", level : 42}
    await page.setExperience("SCM Boy", newExperience)

    const experience = await page.getExperienceForUser("SCM Boy")
    expect(experience).toEqual(newExperience)
  })


  it("should increase an experience", async function() {

    const newExperience = {domain : "Testing", level : 23}
    await page.increaseExperience("SCM Boy", newExperience)

    const experience = await page.getExperienceForUser("SCM Boy")
    expect(experience).toEqual(newExperience)
  })


  it("should delete an experience", async function() {

    const newExperience = {domain : "Testing", level : 23}
    const deletedExperience = {domain : "", level : NaN}
    await page.deleteExperience("SCM Boy", newExperience)

    const experience = await page.getExperienceForUser("SCM Boy")
    expect(experience).toEqual(deletedExperience)
  })
})


