// import DashboardPage from "./pages/dashboard_page";
// import Request from "./helpers/ajaxDownload";

// describe("Dashboard", () => {
//   let page;
//   beforeEach(() => {
//     page = new DashboardPage();
//     return page.get();
//   });

//   function getTabTitle() {
//     return browser.getText(".tab-content h3");
//   }

// describe("NML Download", () => {
//   it("should download an NML file", () => {
//     page.openExplorativeTab();
//     const url = page.getFirstDownloadLink();
//     return Request.text().from(url).then(nmlContent => {
//       expect(nmlContent.length).toBeGreaterThan(0);
//       expect(nmlContent.startsWith("<things>")).toBe(true);
//       expect(nmlContent.endsWith("</things>")).toBe(true);
//     });
//   });
// });

// describe("Tasks", () => {
//   it("should open tasks", () => {
//     page.openTasksTab();
//     expect(getTabTitle()).toBe("Tasks");
//   });

//   it("should have one available task", () => {
//     page.openTasksTab();
//     const tasks = page.getTasks();
//     expect(tasks.length).toBe(1);
//   });

//   it("should get a new task", () => {
//     page.getNewTask();
//     const tasks = page.getTasks();
//     expect(tasks.length).toBe(2);
//   });
// });

// describe("As another user", () => {
//   beforeEach(() => {
//     page.openDashboardAsUser();
//   });

//   it("should display user's tasks", () => {
//     const hasTaskButtonVisible = browser.isExisting(page.newTaskButton);
//     const hasDownloadButtonVisible = browser.isExisting(page.downloadButton);

//     expect(getTabTitle()).toBe("Tasks");
//     expect(hasTaskButtonVisible).toEqual(false);
//     expect(hasDownloadButtonVisible).toEqual(true);
//   });

//   it("should display user's tracked time", () => {
//     page.openTrackedTimeTab();
//     expect(getTabTitle()).toBe("Tracked Time");

//     const timeTableEntries = page.getTimeTableEntries();
//     const timeGraphEntries = page.getTimeGraphEntries();

//     const url = "/api/users/570b9f4d2a7c0e4d008da6ef/loggedTime";
//     return Request.json().from(url).then(response => {
//       const numTimeEntries = response.loggedTime.length;

//       expect(timeTableEntries.length).toEqual(numTimeEntries);
//       expect(timeGraphEntries.length).toEqual(numTimeEntries);
//     });
//   });

//   it("should display user's explorative annotations", () => {
//     page.openExplorativeTab();
//     expect(getTabTitle()).toBe("Explorative Annotations");
//   });
// });
// });
