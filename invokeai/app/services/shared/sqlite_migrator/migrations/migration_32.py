"""Migration 32: Add per-user external provider configuration storage."""

import sqlite3

from invokeai.app.services.shared.sqlite_migrator.sqlite_migrator_common import Migration


class Migration32Callback:
    def __call__(self, cursor: sqlite3.Cursor) -> None:
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS user_external_provider_configs (
                user_id TEXT NOT NULL,
                provider_id TEXT NOT NULL,
                api_key TEXT,
                base_url TEXT,
                created_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
                updated_at DATETIME NOT NULL DEFAULT(STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')),
                PRIMARY KEY (user_id, provider_id),
                FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
            );
        """)

        cursor.execute("""
            CREATE TRIGGER IF NOT EXISTS tg_user_external_provider_configs_updated_at
            AFTER UPDATE ON user_external_provider_configs FOR EACH ROW
            BEGIN
                UPDATE user_external_provider_configs
                SET updated_at = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
                WHERE user_id = old.user_id AND provider_id = old.provider_id;
            END;
        """)


def build_migration_32() -> Migration:
    return Migration(
        from_version=31,
        to_version=32,
        callback=Migration32Callback(),
    )
