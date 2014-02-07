### define
jquery : $
underscore : _
jquery.bootpag : BootPag
../libs/toast : Toast
routes : jsRoutes
###

class Paginator


  constructor: (@pageSelectionDiv, data=null) ->

    @rowsPerPage = 100
    @allElements = null
    @elementsToShow = null

    tableID = @pageSelectionDiv.data("paged-table-id")
    @tbody = $("#"+tableID).find("tbody")

    @extractTemplate()

    if data
      @dataRetrievalPromise = new $.Deferred().resolve()
      @handleData(data)
    else
      @retrieveData()

    searchboxElement = @pageSelectionDiv.find(".pagination-searchbox")
    @addSearchboxListener(searchboxElement)
    @addHashListener(searchboxElement)


  addHashListener : (searchboxElement) ->

    if hash = window.location.hash.slice(1)
      searchboxElement.val(hash).trigger("keyup")

    window.onhashchange = ->
      searchboxElement.val(window.location.hash.slice(1)).trigger("keyup")


  extractTemplate : ->

    templateSource = _.unescape(@tbody.html())
    # compile
    @template = _.template(templateSource)

    @tbody.html("")
    @tbody.removeClass("hide")


  retrieveData : ->

    ajaxOptions =
      url : @pageSelectionDiv.data("url")
      dataType : "json"
      type : "get"

    @dataRetrievalPromise = $.ajax(ajaxOptions)
    @dataRetrievalPromise.then(@handleData)

  handleData: (responseData) =>

    @allElements = @elementsToShow = responseData.data

    pageCount = Math.ceil(@allElements.length / @rowsPerPage)

    pageSelectionHandler = (event, number) =>
      index = number - 1
      json = @getElementsForPage(index)
      @displayJSON(json)

    @pageSelectionDiv.bootpag(
      total: pageCount
      page: 1
      maxVisible: 20
      leaps: true
    ).on("page", pageSelectionHandler)

    # activate the first page
    pageSelectionHandler(null, 1)

    @hideLoader()

    return


  hideLoader : ->

    $("#loader").css("display" : "none")


  getElementsForPage : (index) ->

    start = @rowsPerPage * index
    return @elementsToShow.slice(start, start + @rowsPerPage)


  updatePageCount : ->

    @pageSelectionDiv.bootpag(
      total: Math.ceil(@elementsToShow.length / @rowsPerPage)
      page:  1
    )


  addSearchboxListener : (searchboxElement) ->

    lastQuery = null
    currentQuery = null

    searchboxElement.keyup (event) =>
      @dataRetrievalPromise.done( =>
        newQuery = $(event.currentTarget).val().toLowerCase()

        if newQuery == currentQuery
          return

        currentQuery = currentQuery
        lastQuery = currentQuery
        currentQuery = newQuery

        if currentQuery.length > 0
          @elementsToShow = []

          i = 0
          for task in @allElements
            if @JSONcontains task, currentQuery
              @elementsToShow.push task
        else
          @elementsToShow = @allElements

        @updatePageCount()
        @displayJSON(@getElementsForPage(0))
      )


  displayJSON : (jsonArray) ->

    htmlArray = []

    for element in jsonArray
      htmlArray.push(@generateHTML(element))

    @tbody.html(htmlArray.join(""))


  JSONcontains : (data, query) ->

    contains = false

    $.each data, (key, value) =>

      if _.isObject(value) or _.isArray(value)
         contains = @JSONcontains value, query
         return !contains # if contains then break else continue

      if _.isNumber(value) or _.isString(value)
        # stringify
        value = (value + '').toLowerCase()
        if value.indexOf(query) > -1
          contains = true
          return false # break

    return contains


  generateHTML : (element) ->

    return @template({controllers : jsRoutes.controllers, element : element})

