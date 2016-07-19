React                  = require("react")
ReactDOM               = require("react-dom")
scrollIntoViewIfNeeded = require("scroll-into-view-if-needed")
classNames             = require("classnames")


Comment = React.createClass(

  render : ->

    liClassName = classNames({ "bold" : @props.isActive })
    iClassName = classNames("fa", "fa-fw",
      "fa-angle-right" : @props.isActive
    )

    data = @props.data
    return (
      <li className={liClassName} id={"comment-tab-node-#{data.node}"} ref={ (ref) => @comment = ref }>
        <i className={iClassName}></i>
        <a href="#" onClick={@handleClick}>
          {data.node + " - " + data.content}
        </a>
      </li>
    )


  handleClick : ->

    @props.onNewActiveNode(@props.data, @props.treeId)


  componentDidUpdate : ->

    @ensureVisible()


  ensureVisible : ->

    if @props.isActive
      # use ponyfill as so far only chrome supports this functionality
      scrollIntoViewIfNeeded(@comment)

)

module.exports = Comment
