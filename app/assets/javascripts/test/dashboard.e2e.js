import DashboardPage from "./pages/dashboard_page";
import Request from "./helpers/ajaxDownload";

describe("Dashboard", () => {
  let page;
  beforeEach(() => {
    page = new DashboardPage();
    return page.get();
  });

  function getTabTitle() {
    return browser.getText(".tab-content h3");
  }

  describe("NML Download", () => {
    it("should download an NML file", async () => {
      await page.openExplorativeTab();
      const url = await page.getFirstDownloadLink();
      return Request.text().from(url).then((nmlContent) => {
        expect(nmlContent.length).toBeGreaterThan(0);
        expect(nmlContent.startsWith("<things>")).toBe(true);
        expect(nmlContent.endsWith("</things>")).toBe(true);
      });
    });
  });

  describe("Tasks", () => {
    it("should open tasks", () => page.openTasksTab().then(async () => {
      expect(await getTabTitle()).toBe("Tasks");
    }));


    it("should have one available task", async () => {
      await page.openTasksTab();
      return page.getTasks().then((tasks) => {
        expect(tasks.length).toBe(1);
      });
    });


    it("should get a new task", async () => {
      await page.getNewTask();
      return page.getTasks()
        .then(tasks => expect(tasks.length).toBe(2));
    });
  });


  describe("As another user", () => {
    beforeEach(() => {
      page.openDashboardAsUser();
    });

    it("should display user's tasks", async () => {
      const hasTaskButtonVisible = await browser.isExisting(page.newTaskButton);
      const hasDownloadButtonVisible = await browser.isExisting(page.downloadButton);

      expect(await getTabTitle()).toBe("Tasks");
      expect(hasTaskButtonVisible).toEqual(false);
      expect(hasDownloadButtonVisible).toEqual(true);
    });

    it("should display user's tracked time", async () => {
      await page.openTrackedTimeTab();
      expect(await getTabTitle()).toBe("Tracked Time");

      const timeTableEntries = await page.getTimeTableEntries();
      const timeGraphEntries = await page.getTimeGraphEntries();

      const url = "/api/users/570b9f4d2a7c0e4d008da6ef/loggedTime";
      return Request.json().from(url).then((response) => {
        const numTimeEntries = response.loggedTime.length;

        expect(timeTableEntries.length).toEqual(numTimeEntries);
        expect(timeGraphEntries.length).toEqual(numTimeEntries);
      });
    });

    it("should display user's explorative annotations", async () => {
      await page.openExplorativeTab();
      expect(await getTabTitle()).toBe("Explorative Annotations");
    });
  });
});
