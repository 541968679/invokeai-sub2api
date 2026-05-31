"""Tests for session queue list_all_queue_items() user_id scoping."""

import uuid

import pytest

from invokeai.app.services.invoker import Invoker
from invokeai.app.services.session_queue.session_queue_sqlite import SqliteSessionQueue
from invokeai.app.services.shared.graph import Graph, GraphExecutionState
from tests.test_nodes import PromptTestInvocation


@pytest.fixture
def session_queue(mock_invoker: Invoker) -> SqliteSessionQueue:
    db = mock_invoker.services.board_records._db
    queue = SqliteSessionQueue(db=db)
    queue.start(mock_invoker)
    return queue


def _insert_queue_item(
    session_queue: SqliteSessionQueue,
    queue_id: str,
    user_id: str,
    destination: str | None = None,
) -> None:
    graph = Graph()
    graph.add_node(PromptTestInvocation(id="prompt", prompt="test"))
    session = GraphExecutionState(graph=graph)
    session_json = session.model_dump_json(warnings=False, exclude_none=True)
    session_id = session.id
    batch_id = str(uuid.uuid4())
    with session_queue._db.transaction() as cursor:
        cursor.execute(
            """--sql
            INSERT INTO session_queue (queue_id, session, session_id, batch_id, field_values, priority, workflow, origin, destination, retried_from_item_id, user_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (queue_id, session_json, session_id, batch_id, None, 0, None, None, destination, None, user_id),
        )


def test_list_all_with_user_id_only_returns_own_items(session_queue: SqliteSessionQueue) -> None:
    queue_id = "default"
    _insert_queue_item(session_queue, queue_id, "user_a")
    _insert_queue_item(session_queue, queue_id, "user_a")
    _insert_queue_item(session_queue, queue_id, "user_b")

    items = session_queue.list_all_queue_items(queue_id, user_id="user_a")

    assert len(items) == 2
    assert {item.user_id for item in items} == {"user_a"}


def test_list_all_without_user_id_returns_all_items(session_queue: SqliteSessionQueue) -> None:
    queue_id = "default"
    _insert_queue_item(session_queue, queue_id, "user_a")
    _insert_queue_item(session_queue, queue_id, "user_b")

    items = session_queue.list_all_queue_items(queue_id)

    assert len(items) == 2
    assert {item.user_id for item in items} == {"user_a", "user_b"}


def test_list_all_combines_destination_and_user_filters(session_queue: SqliteSessionQueue) -> None:
    queue_id = "default"
    _insert_queue_item(session_queue, queue_id, "user_a", destination="generate")
    _insert_queue_item(session_queue, queue_id, "user_a", destination="canvas")
    _insert_queue_item(session_queue, queue_id, "user_b", destination="generate")

    items = session_queue.list_all_queue_items(queue_id, destination="generate", user_id="user_a")

    assert len(items) == 1
    assert items[0].user_id == "user_a"
    assert items[0].destination == "generate"
