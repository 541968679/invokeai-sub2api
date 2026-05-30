import asyncio
import time
from threading import Event, Lock

from invokeai.app.services.events.events_common import QueueClearedEvent
from invokeai.app.services.invoker import Invoker
from invokeai.app.services.session_processor.session_processor_base import InvocationServices, SessionRunnerBase
from invokeai.app.services.session_processor.session_processor_default import DefaultSessionProcessor
from invokeai.app.services.session_queue.session_queue_sqlite import SqliteSessionQueue
from invokeai.app.services.shared.graph import Graph, GraphExecutionState
from tests.test_nodes import PromptTestInvocation, wait_until


class SlowSessionRunner(SessionRunnerBase):
    def __init__(self, started: list[int], finished: list[int], lock: Lock, delay: float) -> None:
        self._started = started
        self._finished = finished
        self._lock = lock
        self._delay = delay

    def start(self, services: InvocationServices, cancel_event: Event, profiler=None) -> None:
        self._services = services
        self._cancel_event = cancel_event

    def run(self, queue_item) -> None:
        with self._lock:
            self._started.append(queue_item.item_id)
        time.sleep(self._delay)
        if not self._cancel_event.is_set():
            self._services.session_queue.complete_queue_item(queue_item.item_id)
        with self._lock:
            self._finished.append(queue_item.item_id)

    def run_node(self, invocation, queue_item) -> None:
        pass


class BlockingSessionRunner(SessionRunnerBase):
    def __init__(self, started: list[int], finished: list[int], lock: Lock, release_event: Event) -> None:
        self._started = started
        self._finished = finished
        self._lock = lock
        self._release_event = release_event

    def start(self, services: InvocationServices, cancel_event: Event, profiler=None) -> None:
        self._services = services
        self._cancel_event = cancel_event

    def run(self, queue_item) -> None:
        with self._lock:
            self._started.append(queue_item.item_id)
        self._release_event.wait(timeout=3)
        if not self._cancel_event.is_set():
            self._services.session_queue.complete_queue_item(queue_item.item_id)
        with self._lock:
            self._finished.append(queue_item.item_id)

    def run_node(self, invocation, queue_item) -> None:
        pass


def _insert_queue_item(session_queue: SqliteSessionQueue) -> int:
    graph = Graph()
    graph.add_node(PromptTestInvocation(id="prompt", prompt="test"))
    session = GraphExecutionState(graph=graph)
    with session_queue._db.transaction() as cursor:
        cursor.execute(
            """--sql
            INSERT INTO session_queue (
                queue_id, session, session_id, batch_id, field_values,
                priority, workflow, origin, destination, retried_from_item_id, user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "default",
                session.model_dump_json(warnings=False, exclude_none=True),
                session.id,
                "batch-parallel",
                None,
                0,
                None,
                None,
                "generate",
                None,
                "system",
            ),
        )
        return cursor.lastrowid  # type: ignore[return-value]


def test_session_processor_runs_queue_items_in_parallel(mock_invoker: Invoker) -> None:
    db = mock_invoker.services.board_records._db
    session_queue = SqliteSessionQueue(db=db)
    mock_invoker.services.session_queue = session_queue
    session_queue.start(mock_invoker)
    for _ in range(4):
        _insert_queue_item(session_queue)

    started: list[int] = []
    finished: list[int] = []
    lock = Lock()
    processor = DefaultSessionProcessor(
        session_runner_factory=lambda: SlowSessionRunner(started, finished, lock, delay=0.6),
        thread_limit=4,
        polling_interval=0.01,
    )
    mock_invoker.services.session_processor = processor

    start = time.perf_counter()
    processor.start(mock_invoker)
    try:
        wait_until(lambda: len(finished) == 4, timeout=3, interval=0.02)
    finally:
        processor.stop()

    elapsed = time.perf_counter() - start
    assert elapsed < 1.6
    assert len(started) == 4
    assert sorted(started) == sorted(set(started))
    assert session_queue.get_queue_status("default").completed == 4


def test_session_processor_respects_concurrency_limit(mock_invoker: Invoker) -> None:
    db = mock_invoker.services.board_records._db
    session_queue = SqliteSessionQueue(db=db)
    mock_invoker.services.session_queue = session_queue
    session_queue.start(mock_invoker)
    for _ in range(4):
        _insert_queue_item(session_queue)

    started: list[int] = []
    finished: list[int] = []
    lock = Lock()
    processor = DefaultSessionProcessor(
        session_runner_factory=lambda: SlowSessionRunner(started, finished, lock, delay=0.6),
        thread_limit=2,
        polling_interval=0.01,
    )
    mock_invoker.services.session_processor = processor

    start = time.perf_counter()
    processor.start(mock_invoker)
    try:
        wait_until(lambda: len(finished) == 4, timeout=3, interval=0.02)
    finally:
        processor.stop()

    elapsed = time.perf_counter() - start
    assert 1.1 <= elapsed < 2.1
    assert session_queue.get_queue_status("default").completed == 4


def test_session_processor_wakes_all_workers_for_enqueued_batch(mock_invoker: Invoker) -> None:
    db = mock_invoker.services.board_records._db
    session_queue = SqliteSessionQueue(db=db)
    mock_invoker.services.session_queue = session_queue
    session_queue.start(mock_invoker)

    started: list[int] = []
    finished: list[int] = []
    lock = Lock()
    release_event = Event()
    processor = DefaultSessionProcessor(
        session_runner_factory=lambda: BlockingSessionRunner(started, finished, lock, release_event),
        thread_limit=4,
        polling_interval=5,
    )
    mock_invoker.services.session_processor = processor

    processor.start(mock_invoker)
    try:
        for _ in range(4):
            _insert_queue_item(session_queue)
        processor._poll_now()

        wait_until(lambda: len(started) == 4, timeout=1, interval=0.02)
        assert session_queue.get_queue_status("default").in_progress == 4

        release_event.set()
        wait_until(lambda: len(finished) == 4, timeout=3, interval=0.02)
    finally:
        release_event.set()
        processor.stop()

    assert session_queue.get_queue_status("default").completed == 4


def test_queue_cleared_event_only_cancels_terminal_active_items(mock_invoker: Invoker) -> None:
    db = mock_invoker.services.board_records._db
    session_queue = SqliteSessionQueue(db=db)
    mock_invoker.services.session_queue = session_queue
    session_queue.start(mock_invoker)

    started: list[int] = []
    finished: list[int] = []
    lock = Lock()
    release_event = Event()
    processor = DefaultSessionProcessor(
        session_runner_factory=lambda: BlockingSessionRunner(started, finished, lock, release_event),
        thread_limit=2,
        polling_interval=5,
    )
    mock_invoker.services.session_processor = processor

    processor.start(mock_invoker)
    try:
        first_item_id = _insert_queue_item(session_queue)
        second_item_id = _insert_queue_item(session_queue)
        processor._poll_now()
        wait_until(lambda: len(started) == 2, timeout=1, interval=0.02)

        session_queue.cancel_queue_item(first_item_id)
        asyncio.run(processor._on_queue_cleared((QueueClearedEvent.__event_name__, QueueClearedEvent.build("default"))))

        release_event.set()
        wait_until(lambda: len(finished) == 2, timeout=3, interval=0.02)
    finally:
        release_event.set()
        processor.stop()

    assert session_queue.get_queue_item(first_item_id).status == "canceled"
    assert session_queue.get_queue_item(second_item_id).status == "completed"
