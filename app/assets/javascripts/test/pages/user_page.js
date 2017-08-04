export default class UserPage {
  userListElements = ".ant-table-row";
  changeExperienceButton = "#main-container > div > div > button:nth-child(4)";
  changeTeamButton = "#main-container > div > div > button:nth-child(3)";
  modal = ".ant-modal-content";
  confirmButton = ".ant-btn-primary";

  inputExperienceDomain = "div.ant-modal-body > span:nth-child(1) > input";
  inputExperienceLevel = "div.ant-modal-body > span:nth-child(2) > input";
  setExperienceButton = "div.ant-modal-footer > div > button:nth-child(2)";
  increaseExperienceButton = "div.ant-modal-footer > div > button:nth-child(1)";
  deleteExperienceButton = "div.ant-modal-footer > div > button:nth-child(3)";

  selectFirstUserCheckbox = "table > tbody > tr:nth-child(1) > td.ant-table-selection-column > span > label > span > input";
  selectSecondTeamCheckbox = "div.ant-modal-body > div:nth-child(3) > div:nth-child(1) > label > span.ant-checkbox.ant-checkbox-checked > input";
  selectSecondTeamUserRole = "div.ant-modal-body > div:nth-child(3) > div:nth-child(2) > div > label.ant-radio-button-wrapper:nth-child(2) > span:nth-child(2)";

  get() {
    browser.url("/users");
  }

  getUserListEntries() {
    browser.waitForExist(this.userListElements);
    return browser.elements(this.userListElements).value;
  }

  selectSingleUser() {
    browser.waitForExist(this.selectFirstUserCheckbox);
    browser.click(this.selectFirstUserCheckbox);
  }

  clickConfirmButton() {
    browser.waitForExist(this.confirmButton);
    browser.pause(1000); // allow modal to fully fade in
    browser.click(this.confirmButton);
    browser.pause(500); // wait for DOM updates
  }

  selectSecondTeamRole() {
    browser.waitForExist(this.changeTeamButton);
    browser.pause(3000);
    browser.click(this.changeTeamButton);
    browser.waitForVisible(this.modal);
    browser.waitForExist(this.selectSecondTeamUserRole);
    browser.click(this.selectSecondTeamUserRole);
    browser.pause(3000);
  }

  unSelectSecondTeam() {
    browser.waitForExist(this.changeTeamButton);
    browser.pause(3000);
    browser.click(this.changeTeamButton);
    browser.waitForVisible(this.modal);
    browser.waitForExist(this.selectSecondTeamCheckbox);
    browser.pause(3000);
    browser.click(this.selectSecondTeamCheckbox);
  }

  openExperienceModal() {
    this.selectSingleUser();
    browser.waitForExist(this.changeExperienceButton);
    browser.click(this.changeExperienceButton);
    browser.pause(1000);
    browser.waitForExist(this.modal);
    browser.waitForExist(this.inputExperienceDomain);
  }

  setExperience(experience) {
    this.openExperienceModal();
    browser.setValue(this.inputExperienceDomain, experience.domain);
    browser.setValue(this.inputExperienceLevel, experience.level);
    browser.click(this.setExperienceButton);
  }

  increaseExperience(experience) {
    this.openExperienceModal();
    browser.setValue(this.inputExperienceDomain, experience.domain);
    browser.setValue(this.inputExperienceLevel, experience.level);
    browser.click(this.increaseExperienceButton);
  }

  deleteExperience(experience) {
    this.openExperienceModal();
    browser.setValue(this.inputExperienceDomain, experience.domain);
    browser.click(this.deleteExperienceButton);
  }
}
