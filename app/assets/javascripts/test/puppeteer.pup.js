import test from "ava";
import puppeteer from "puppeteer";
import DashboardPage from "./pages/dashboard_page";

let browser;

test.before(async _ => {
  browser = await puppeteer.launch();
});

test.after(_ => {
  browser.close();
});

test.beforeEach(async t => {
  const page = await browser.newPage();
  page.setViewport({ width: 1920, height: 1080 });
  await page.goto("http://localhost:9000/dashboard");

  t.context.dashboard = new DashboardPage(page);
});

test("should open tasks", t => {
  const { dashboard } = t.context;
  dashboard.openTasksTab();
  t.is(dashboard.getTabDescription(), "Tasks");
});

test("should have one available task", t => {
  const { dashboard } = t.context;
  dashboard.openTasksTab();
  const tasks = dashboard.getTasks();
  t.is(tasks.length, 1);
});

test("should get a new task", t => {
  const { dashboard } = t.context;
  dashboard.getNewTask();
  const tasks = dashboard.getTasks();
  t.is(tasks.length, 2);
});
