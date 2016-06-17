React      = require("react")
ReactDOM   = require("react-dom")
Utils      = require("libs/utils")


Comment = React.createClass(

  render : ->

    data = @props.model.attributes
    return (
      <li>
        <i className={"fa " + "fa-angle-right" if @props.isActive}></i>
        <a href="#" onClick={@handleClick} >{data.node + " - " + data.content}</a>
      </li>
    )


  handleClick : ->

    @props.onNewActiveNode(@props.model)


  componentDidUpdate : ->

    @ensureVisible()


  ensureVisible : ->

    el = ReactDOM.findDOMNode(@)
    if @props.isActive
      el.scrollIntoViewIfNeeded()

)


CommentList = React.createClass(

  render : ->

    return null unless @state.data.length

    activeNodeId = @state.activeNodeId

    groupedComments = @state.data.groupBy( (comment) -> comment.get("treeId") )
    commentAndTreeNodes = _.map(groupedComments, (comments, treeId) =>

      commentNodes = comments.map( (comment) =>

        nodeId = comment.get("node")
        return (
          <Comment
            key={nodeId}
            model={comment}
            isActive={nodeId == activeNodeId}
            onNewActiveNode={@props.onNewActiveNode}
          />
        )
      )

      return (
        <div key={treeId}>
          <li>
            <i className="fa fa-tree"></i>
            {treeId}
          </li>
          {commentNodes}
        </div>
      )
    )

    return (
      <div className="commentList">
        {commentAndTreeNodes}
      </div>
    )


  getInitialState : ->

    return {
      data : []
      activeNodeId : 0
    }
)

module.exports = CommentList
