import RegisterPage from "./pages/register_page";

describe("Register", () => {
  let page;

  beforeEach(() => {
    page = new RegisterPage();
    page.get();
  });

  describe("SignUp", () => {
    it("should send complete form", async () => {
      await page.signUpWithCompleteForm();
      const modalText = await page.getModalText();
      expect(modalText).toEqual("Your account has been created. An administrator is going to unlock you soon.");
    });
  });
});
