//! Composable SQL on sqlx's [`QueryBuilder`]. Reusable predicates push their
//! SQL text and bind their own values, so callers never number `$n`
//! placeholders by hand and fragments compose in any order. Never write a
//! literal `$n` into a builder: `push_bind` numbers the parameters itself.
use sqlx::{Postgres, QueryBuilder};

use crate::{auth::AuthUser, util::id::ObjectId};

pub type Sql<'a> = QueryBuilder<'a, Postgres>;

/// A text operand of a reusable predicate.
#[derive(Clone, Copy, Debug)]
pub enum Arg<'a> {
    /// Bound as a parameter (`NULL` for `None`).
    Bind(Option<&'a str>),
    /// Spliced verbatim: a column or expression of the enclosing statement,
    /// e.g. to evaluate a requester grant per row. Never request input.
    Sql(&'static str),
}

impl<'a> From<&'a str> for Arg<'a> {
    fn from(value: &'a str) -> Self {
        Self::Bind(Some(value))
    }
}

impl<'a> From<Option<&'a str>> for Arg<'a> {
    fn from(value: Option<&'a str>) -> Self {
        Self::Bind(value)
    }
}

impl<'a> From<&'a ObjectId> for Arg<'a> {
    fn from(value: &'a ObjectId) -> Self {
        Self::Bind(Some(value.as_str()))
    }
}

impl<'a> From<Option<&'a ObjectId>> for Arg<'a> {
    fn from(value: Option<&'a ObjectId>) -> Self {
        Self::Bind(value.map(ObjectId::as_str))
    }
}

pub trait PushArg<'a> {
    fn push_arg(&mut self, arg: Arg<'a>) -> &mut Self;
}

impl<'a> PushArg<'a> for Sql<'a> {
    fn push_arg(&mut self, arg: Arg<'a>) -> &mut Self {
        match arg {
            Arg::Bind(value) => self.push_bind(value),
            Arg::Sql(expression) => self.push(expression),
        }
    }
}

/// The requester an access predicate is evaluated for: id, organization and
/// whether they administer that organization. Anonymous requesters bind
/// `NULL`s and `false`, so requester grants never match.
#[derive(Clone, Copy, Debug)]
pub struct Requester<'a> {
    pub id: Arg<'a>,
    pub organization: Arg<'a>,
    pub is_admin: bool,
}

impl<'a> From<&'a AuthUser> for Requester<'a> {
    fn from(user: &'a AuthUser) -> Self {
        Self::from(Some(user))
    }
}

impl<'a> From<Option<&'a AuthUser>> for Requester<'a> {
    fn from(user: Option<&'a AuthUser>) -> Self {
        Self {
            id: user.map(|u| &u.id).into(),
            organization: user.map(|u| u.organization_id.as_str()).into(),
            is_admin: user.is_some_and(|u| u.is_admin),
        }
    }
}
