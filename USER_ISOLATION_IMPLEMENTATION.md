# User Isolation Implementation Summary

## Current PoC Status

This local branch now contains the first end-to-end PoC for running InvokeAI as a
multi-user project with per-user OpenAI-compatible external generation keys.

### Runtime and Local Test Harness

- Added `scripts/dev-stack.ps1` and `scripts/dev-stack.cmd` to start, stop,
  restart, and inspect the local InvokeAI test instance.
- The local PoC always binds InvokeAI to `http://127.0.0.1:9090`.
- The script writes a fixed runtime config under
  `E:\cursor project\invokeai-sub2api-poc` and enables:
  - `multiuser: true`
  - `strict_password_checking: true`
  - local built-in admin support
- Local test admin credentials are:
  - username: `admin`
  - password: `admin123`
- The built-in admin path disables backend setup account creation and the
  frontend `/setup` route now falls back to login instead of exposing an
  administrator creation screen.

### Per-User External Provider Configuration

- Added SQLite migration `migration_32.py` for
  `user_external_provider_configs`.
- Added the `user_external_provider_configs` service with helpers to get, set,
  and delete a user's provider configuration.
- In multi-user mode, these API routes are now scoped to the authenticated user:
  - `GET /api/v1/app/external_providers/config`
  - `POST /api/v1/app/external_providers/config/{provider_id}`
  - `DELETE /api/v1/app/external_providers/config/{provider_id}`
- In single-user mode, the existing global `api_keys.yaml` behavior is retained
  for upstream compatibility.
- API keys are stored in SQLite in plaintext for this PoC. A later migration can
  add encryption without changing the user-facing API shape.

### External Generation Isolation

- `ExternalGenerationRequest` now carries `user_id`.
- The external image generation invocation passes `queue_item.user_id` into the
  external generation request.
- `OpenAIProvider.generate()` resolves the API key and base URL from
  `user_external_provider_configs` in multi-user mode.
- If the current user has not configured OpenAI, generation fails with a clear
  user-scoped configuration error instead of falling back to another user's key.
- Single-user mode still reads `external_openai_api_key` and
  `external_openai_base_url` from the existing global app config path.

### Frontend UX

- The setup route is no longer an administrator creation entry point in the local
  built-in-admin PoC.
- Admin user management is exposed as a visible left-nav action for admin users.
- The Models page keeps a full **Add Models** entry visible for admins even when
  a model is selected and the right pane is showing model details.
- For non-admin users, the Models page also shows **Add Models**, but clicking it
  opens only the **External Providers** configuration form. This lets users save
  their own API key/base URL without exposing instance-level model installation
  flows such as URL installs, HuggingFace, scan folder, or starter model install.
- The regular full Add Models panel remains admin-only and still contains:
  Launchpad, URL or Local Path, HuggingFace, External Providers, Scan Folder, and
  Starter Models.

### Verified Locally

- Backend focused tests for built-in admin and per-user external provider config
  passed.
- Frontend TypeScript checks passed.
- Focused ESLint checks passed for the modified model manager files.
- Vite production builds passed after each frontend change.
- InvokeAI was restarted through `scripts/dev-stack.ps1` and verified listening
  on `127.0.0.1:9090`.

### Current Manual Test Flow

1. Start or restart InvokeAI:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev-stack.ps1 restart
   ```

2. Open `http://127.0.0.1:9090`.
3. Log in as `admin / admin123`.
4. Use the left-nav user-management button or direct route
   `http://127.0.0.1:9090/admin/users` to create normal users.
5. Log in as a normal user.
6. Go to **Models** -> **Add Models**.
7. Confirm the user sees only **External Providers**.
8. Configure the `openai` provider with the user's own API key and base URL.
9. Repeat with a second user and confirm provider status/base URL isolation.
10. Select an external OpenAI-compatible model and generate; the request should
    use the current queue item's `user_id` to resolve that user's credentials.

### Follow-Up Items

- Add encryption-at-rest for `user_external_provider_configs.api_key`.
- Add browser-level regression tests for admin vs. normal-user model manager
  entry behavior.
- Complete a two-user manual generation test against Sub2API using different
  keys/base URLs.
- Decide whether the normal-user button label should remain **Add Models** for
  consistency or be changed to a more explicit External Provider label.

This document describes the implementation of user isolation features in the InvokeAI session queue and processing system to address issues identified in the enhancement request.

## Issues Addressed

### 1. Cross-User Image/Preview Visibility
**Problem:** When two users are logged in simultaneously and one initiates a generation, the generation preview shows up in both users' browsers and the generated image gets saved to both users' image boards.

**Solution:** Implemented socket-level event filtering based on user authentication:

#### Backend Changes (`invokeai/app/api/sockets.py`):
- Added socket authentication middleware in `_handle_connect()` method
- Extracts JWT token from socket auth data or HTTP headers
- Verifies token using existing `verify_token()` function
- Stores `user_id` and `is_admin` in socket session for later use
- Modified `_handle_queue_event()` to filter events by user:
  - For `QueueItemEventBase` events, only emit to:
    - The user who owns the queue item (`user_id` matches)
    - Admin users (`is_admin` is True)
  - For general queue events, emit to all subscribers

#### Event System Changes (`invokeai/app/services/events/events_common.py`):
- Added `user_id` field to `QueueItemEventBase` class
- Updated all event builders to include `user_id` from queue items:
  - `InvocationStartedEvent.build()`
  - `InvocationProgressEvent.build()`
  - `InvocationCompleteEvent.build()`
  - `InvocationErrorEvent.build()`
  - `QueueItemStatusChangedEvent.build()`

### 2. Batch Field Values Privacy
**Problem:** Users can see batch field values from generation processes launched by other users.

**Solution:** Implemented field value sanitization at the API level:

#### API Router Changes (`invokeai/app/api/routers/session_queue.py`):
- Created `sanitize_queue_item_for_user()` helper function
  - Clears `field_values` for non-admin users viewing other users' items
  - Admins and item owners can see all field values
- Updated endpoints to require authentication and sanitize responses:
  - `list_all_queue_items()` - Added `CurrentUser` dependency
  - `get_queue_items_by_item_ids()` - Added `CurrentUser` dependency
  - `get_queue_item()` - Added `CurrentUser` dependency

### 3. Queue Updates Across Browser Windows
**Problem:** When the job queue tab is open in multiple browsers and a generation is begun in one browser window, the queue does not update in the other window.

**Status:** This issue is likely resolved by the socket authentication and event filtering changes. The existing socket subscription mechanism (`subscribe_queue` event) already supports multiple connections per user. Testing is required to confirm this works correctly with the new authentication flow.

### 4. User Information Display
**Problem:** Queue table lacks user identification, making it difficult to know who launched which job.

**Solution:** Added user information to queue items and UI:

#### Database Layer (`invokeai/app/services/session_queue/session_queue_sqlite.py`):
- Updated SQL queries to JOIN with `users` table
- Modified methods to fetch user information:
  - `get_queue_item()` - Now selects `display_name` and `email` from users table
  - `dequeue()` - Includes user info
  - `get_next()` - Includes user info
  - `get_current()` - Includes user info
  - `list_all_queue_items()` - Includes user info

#### Data Model Changes (`invokeai/app/services/session_queue/session_queue_common.py`):
- Added optional fields to `SessionQueueItem`:
  - `user_display_name: Optional[str]` - Display name from users table
  - `user_email: Optional[str]` - Email from users table
  - Note: `user_id` field already existed from Migration 25

#### Frontend UI Changes:
- **Constants** (`constants.ts`): Added `user: '8rem'` column width
- **Header** (`QueueListHeader.tsx`): Added "User" column header
- **Item Component** (`QueueItemComponent.tsx`):
  - Added logic to display user information (display_name → email → user_id)
  - Added user column to queue item row
  - Added tooltip with full username on hover
  - Added "Hidden for privacy" message when field_values are null for non-owned items
- **Localization** (`en.json`): Added translations:
  - `"user": "User"`
  - `"fieldValuesHidden": "Hidden for privacy"`

## Security Considerations

### Token Verification
- Tokens are verified using the existing `verify_token()` function from `invokeai.app.services.auth.token_service`
- Invalid or missing tokens default to "system" user with non-admin privileges
- Socket connections without valid tokens are still accepted for backward compatibility but have limited access

### Data Privacy
- Field values are only visible to:
  - The user who created the queue item
  - Admin users
- Non-admin users viewing other users' queue items see "Hidden for privacy" instead of field values

### Admin Privileges
- Admin users can see all queue events and field values across all users
- Admin status is determined from the JWT token's `is_admin` field

## Migration Notes

No database migration is required. The changes leverage:
- Existing `user_id` column in `session_queue` table (added in Migration 25)
- Existing `users` table (added in Migration 25)
- SQL LEFT JOINs to fetch user information (gracefully handles missing user records)

## Testing Requirements

### Backend Testing
1. **Socket Authentication:**
   - Verify valid tokens are accepted and user context is stored
   - Verify invalid tokens default to system user
   - Verify expired tokens are rejected

2. **Event Filtering:**
   - User A should only receive events for their own queue items
   - Admin users should receive all events
   - Non-admin users should not receive events from other users

3. **Field Value Sanitization:**
   - Non-admin users should see null field_values for other users' items
   - Admins should see all field values
   - Users should see their own field values

### Frontend Testing
1. **UI Display:**
   - User column should display in queue list
   - Display name should be shown when available
   - Email should be shown as fallback when display name is missing
   - User ID should be shown when both display name and email are missing
   - Tooltip should show full username on hover

2. **Field Values Display:**
   - "Hidden for privacy" message should appear when viewing other users' items
   - Own items should show field values normally

3. **Multi-Browser Testing:**
   - Open queue tab in two browsers with different users
   - Start generation in one browser
   - Verify other browser doesn't see the preview/progress
   - Verify admin user can see all generations

### Integration Testing
1. Multi-user scenarios with simultaneous generations
2. Queue updates across multiple browser windows
3. Admin vs. non-admin privilege differentiation
4. Socket reconnection handling

## Known Limitations

1. **TypeScript Types:**
   - The OpenAPI schema needs to be regenerated to include new fields
   - Run: `cd invokeai/frontend/web && python ../../../scripts/generate_openapi_schema.py | pnpm typegen`

2. **Backward Compatibility:**
   - System user ("system") entries will not have display name or email
   - Existing queue items from before Migration 25 will have user_id="system"

3. **Socket.IO Session Storage:**
   - Socket.IO's in-memory session storage may not persist across server restarts
   - Consider implementing persistent session storage if needed for production

## Future Enhancements

1. Add user filtering to queue list (show only my items vs. all items)
2. Add permission system for queue management operations (cancel, retry, delete)
3. Implement queue item ownership transfer for administrative purposes
4. Add audit logging for queue operations with user attribution
5. Consider implementing user-specific queue limits or quotas
