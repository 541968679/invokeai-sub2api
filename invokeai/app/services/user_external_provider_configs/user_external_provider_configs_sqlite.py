from __future__ import annotations

from dataclasses import dataclass

from invokeai.app.services.shared.sqlite.sqlite_database import SqliteDatabase


@dataclass(frozen=True)
class UserExternalProviderConfig:
    user_id: str
    provider_id: str
    api_key: str | None
    base_url: str | None


class UserExternalProviderConfigService:
    """SQLite-backed per-user external provider configuration storage."""

    def __init__(self, db: SqliteDatabase) -> None:
        self._db = db

    def get(self, user_id: str, provider_id: str) -> UserExternalProviderConfig | None:
        with self._db.transaction() as cursor:
            cursor.execute(
                """
                SELECT user_id, provider_id, api_key, base_url
                FROM user_external_provider_configs
                WHERE user_id = ? AND provider_id = ?;
                """,
                (user_id, provider_id),
            )
            row = cursor.fetchone()

        if row is None:
            return None

        return UserExternalProviderConfig(
            user_id=row["user_id"],
            provider_id=row["provider_id"],
            api_key=row["api_key"],
            base_url=row["base_url"],
        )

    def set(
        self,
        user_id: str,
        provider_id: str,
        api_key: str | None,
        base_url: str | None,
    ) -> UserExternalProviderConfig:
        with self._db.transaction() as cursor:
            cursor.execute(
                """
                INSERT INTO user_external_provider_configs (user_id, provider_id, api_key, base_url)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, provider_id) DO UPDATE SET
                    api_key = excluded.api_key,
                    base_url = excluded.base_url,
                    updated_at = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW');
                """,
                (user_id, provider_id, api_key, base_url),
            )

        config = self.get(user_id, provider_id)
        if config is None:
            raise RuntimeError("Failed to retrieve saved external provider config")
        return config

    def delete(self, user_id: str, provider_id: str) -> None:
        with self._db.transaction() as cursor:
            cursor.execute(
                """
                DELETE FROM user_external_provider_configs
                WHERE user_id = ? AND provider_id = ?;
                """,
                (user_id, provider_id),
            )
