from logging import Logger

from invokeai.app.api.dependencies import ensure_builtin_admin
from invokeai.app.services.config.config_default import InvokeAIAppConfig
from invokeai.app.services.shared.sqlite.sqlite_database import SqliteDatabase
from invokeai.app.services.users.users_common import UserCreateRequest
from invokeai.app.services.users.users_default import UserService


def _build_user_service() -> UserService:
    db = SqliteDatabase(db_path=None, logger=Logger("test_builtin_admin"), verbose=False)
    db._conn.execute("""
        CREATE TABLE users (
            user_id TEXT NOT NULL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            display_name TEXT,
            password_hash TEXT NOT NULL,
            is_admin BOOLEAN NOT NULL DEFAULT FALSE,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
            updated_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
            last_login_at DATETIME
        );
    """)
    db._conn.commit()
    return UserService(db)


def test_ensure_builtin_admin_creates_and_authenticates() -> None:
    users = _build_user_service()
    config = InvokeAIAppConfig(
        multiuser=True,
        builtin_admin_enabled=True,
        builtin_admin_username="admin",
        builtin_admin_password="admin123",
    )

    ensure_builtin_admin(config=config, users=users, logger=Logger("test_builtin_admin"))

    admin = users.authenticate("admin", "admin123")
    assert admin is not None
    assert admin.email == "admin"
    assert admin.is_admin is True
    assert admin.is_active is True


def test_ensure_builtin_admin_repairs_existing_account() -> None:
    users = _build_user_service()
    users.create(
        user_data=UserCreateRequest(
            email="admin",
            display_name="Old Admin",
            password="oldpass",
            is_admin=False,
        ),
        strict_password_checking=False,
    )
    config = InvokeAIAppConfig(
        multiuser=True,
        builtin_admin_enabled=True,
        builtin_admin_username="admin",
        builtin_admin_password="admin123",
    )

    ensure_builtin_admin(config=config, users=users, logger=Logger("test_builtin_admin"))

    admin = users.authenticate("admin", "admin123")
    assert admin is not None
    assert admin.is_admin is True
    assert admin.is_active is True
