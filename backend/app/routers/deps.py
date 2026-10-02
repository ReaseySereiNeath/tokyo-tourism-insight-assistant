"""Shared request dependencies."""
import sqlite3
from collections.abc import Iterator

from fastapi import Query

from app.db import Scope, get_conn


def scope_param(scope: Scope = Query("real", description="'real' (your imports) or 'demo' (synthetic data)")) -> Scope:
    return scope


def db(scope: Scope = Query("real")) -> Iterator[sqlite3.Connection]:
    yield from get_conn(scope)
