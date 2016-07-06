React      = require("react")
ReactDOM   = require("react-dom")
Comment    = require("./comment")
classNames = require("classnames")


TreeCommentList = React.createClass(

  render : ->

    containsActiveNode = @props.treeId == @props.activeTreeId

    # don't render the comment nodes if the tree is collapsed
    commentNodes = if not @state.collapsed then @props.comments.map( (comment) =>
      return (
        <Comment
          key={comment.node}
          data={comment}
          treeId={@props.treeId}
          isActive={comment.node == @props.activeNodeId}
          onNewActiveNode={@props.onNewActiveNode}
        />
      )
    ) else null

    liClassName = classNames({ "bold" : containsActiveNode })
    iClassName = classNames("fa", "fa-fw",
      "fa-chevron-right" : @state.collapsed
      "fa-chevron-down" : !@state.collapsed
    )

    # one tree and its comments
    return (
      <div>
        <li className={liClassName}>
          <i className={iClassName} onClick={@handleClick}></i>
          {@props.treeId} - {@props.treeName}
        </li>
        {commentNodes}
      </div>
    )


  handleClick : ->

    @setState({ collapsed : !@state.collapsed })


  getInitialState : ->

    return { collapsed : false }
)

module.exports = TreeCommentList
