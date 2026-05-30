import { useAppSelector } from 'app/store/storeHooks';
import { selectCurrentUser } from 'features/auth/store/authSlice';
import { useCallback, useMemo } from 'react';
import { useGetSetupStatusQuery } from 'services/api/endpoints/auth';
import { useGetCurrentQueueItemsQuery } from 'services/api/endpoints/queue';

import { useCancelQueueItem } from './useCancelQueueItem';

export const useCancelCurrentQueueItem = () => {
  const { data: currentQueueItems } = useGetCurrentQueueItemsQuery();
  const currentUser = useAppSelector(selectCurrentUser);
  const { data: setupStatus } = useGetSetupStatusQuery();
  const cancelQueueItem = useCancelQueueItem();

  const currentQueueItemId = useMemo(() => {
    if (!currentQueueItems?.length) {
      return null;
    }
    if (setupStatus && !setupStatus.multiuser_enabled) {
      return currentQueueItems[0]?.item_id ?? null;
    }
    if (currentUser?.is_admin) {
      return currentQueueItems[0]?.item_id ?? null;
    }
    return currentQueueItems.find((item) => item.user_id === currentUser?.user_id)?.item_id ?? null;
  }, [currentQueueItems, currentUser, setupStatus]);

  // Check if current user can cancel the current item
  const canCancelCurrentItem = useMemo(() => {
    // In single-user mode, allow canceling current item without auth checks.
    if (setupStatus && !setupStatus.multiuser_enabled) {
      return true;
    }

    if (!currentUser || !currentQueueItems?.length) {
      return false;
    }
    // Admin users can cancel all items
    if (currentUser.is_admin) {
      return true;
    }
    // Non-admin users can only cancel their own items
    return currentQueueItems.some((item) => item.user_id === currentUser.user_id);
  }, [setupStatus, currentUser, currentQueueItems]);

  const trigger = useCallback(
    (options?: { withToast?: boolean }) => {
      if (currentQueueItemId === null) {
        return;
      }
      cancelQueueItem.trigger(currentQueueItemId, options);
    },
    [currentQueueItemId, cancelQueueItem]
  );

  return {
    trigger,
    isLoading: cancelQueueItem.isLoading,
    isDisabled: cancelQueueItem.isDisabled || currentQueueItemId === null || !canCancelCurrentItem,
  };
};
