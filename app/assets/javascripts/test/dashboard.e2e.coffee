
describe 'Dashboard View', ->
  EC = protractor.ExpectedConditions

  findTabs = ->
    tabs = element(By.id('tabbable-dashboard'))
    isVisible = EC.visibilityOf tabs

    return browser.wait isVisible, 5000
      .then -> return tabs

  beforeEach ->
    browser.get '/dashboard'

  it 'should have webKnossos page title', ->
    expect(browser.getTitle()).toEqual('webKnossos')

  it 'should use gallery view by default', (done) ->
    findTabs()
      .then (tabs) ->
        pagination = tabs.element(By.className('pagination'))
        dataset = tabs.element(By.className('dataset-region'))

        expect(pagination.isPresent()).toBeFalse
        expect(dataset.isPresent()).toBeFalse
        done()

  it 'should show "advanced view" button by default', (done) ->
    advancedViewButton = element(By.id('showAdvancedView'))
    galleryViewButton = element(By.id('showGalleryView'))
    isVisible = EC.and(
      EC.visibilityOf advancedViewButton,
      EC.visibilityOf galleryViewButton
    )

    browser.wait isVisible, 5000
      .then ->
        expect(advancedViewButton.isDisplayed()).toBeTruthy
        expect(galleryViewButton.isDisplayed()).toBeFalse
        done()
