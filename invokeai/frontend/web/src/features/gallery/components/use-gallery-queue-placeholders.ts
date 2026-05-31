import { useAppSelector } from 'app/store/storeHooks';
import { selectCurrentUser } from 'features/auth/store/authSlice';
import { selectGalleryView } from 'features/gallery/store/gallerySelectors';
import { useEffect, useMemo, useState } from 'react';
import { queueApi, type SessionQueueItemStatus } from 'services/api/endpoints/queue';
import type { S } from 'services/api/types';

const ACTIVE_STATUSES = new Set<SessionQueueItemStatus>(['pending', 'in_progress']);
const EXTERNAL_GENERATION_NODE_TYPES = new Set([
  'alibabacloud_image_generation',
  'gemini_image_generation',
  'openai_image_generation',
  'seedream_image_generation',
]);
const emptyItems: S['SessionQueueItem'][] = [];

const queueQueryOptions = {
  pollingInterval: 2000,
  refetchOnFocus: true,
  refetchOnReconnect: true,
};

export const useGalleryQueuePlaceholders = () => {
  const currentUser = useAppSelector(selectCurrentUser);
  const galleryView = useAppSelector(selectGalleryView);
  const [now, setNow] = useState(() => Date.now());
  const shouldFetch = galleryView === 'images';

  const queueQuery = queueApi.endpoints.listAllQueueItems.useQuery(undefined, {
    ...queueQueryOptions,
    skip: !shouldFetch,
  });

  const placeholders = useMemo(() => {
    if (!shouldFetch) {
      return emptyItems;
    }

    const byId = new Map<number, S['SessionQueueItem']>();
    const sourceItems = queueQuery.data ?? emptyItems;

    for (const item of sourceItems) {
      if (!ACTIVE_STATUSES.has(item.status)) {
        continue;
      }
      if (!isExternalGenerationQueueItem(item)) {
        continue;
      }
      if (!currentUser?.is_admin && item.user_id !== currentUser?.user_id) {
        continue;
      }
      byId.set(item.item_id, item);
    }

    return Array.from(byId.values()).sort((a, b) => b.item_id - a.item_id);
  }, [currentUser?.is_admin, currentUser?.user_id, queueQuery.data, shouldFetch]);

  useEffect(() => {
    if (!placeholders.length) {
      return;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [placeholders.length]);

  return {
    placeholders,
    now,
  };
};

export const getQueueItemPromptPreview = (item: S['SessionQueueItem']) => {
  const promptValue = item.field_values?.find(({ field_name, node_path, value }) => {
    return field_name === 'value' && node_path.includes('positive_prompt') && typeof value === 'string';
  })?.value;

  if (typeof promptValue === 'string') {
    return promptValue;
  }

  const fallbackString = item.field_values?.find(({ value }) => typeof value === 'string')?.value;
  return typeof fallbackString === 'string' ? fallbackString : '';
};

const isExternalGenerationQueueItem = (item: S['SessionQueueItem']) => {
  return getExternalGenerationNode(item) !== null;
};

const getExternalGenerationNode = (item: S['SessionQueueItem']) => {
  const nodes = item.session.graph.nodes ?? {};
  for (const node of Object.values(nodes)) {
    if (!isRecord(node)) {
      continue;
    }
    if (typeof node.type === 'string' && EXTERNAL_GENERATION_NODE_TYPES.has(node.type)) {
      return node;
    }
  }
  return null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};
