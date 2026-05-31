import {
  Badge,
  Button,
  ButtonGroup,
  Divider,
  Flex,
  Heading,
  IconButton,
  Spinner,
  Text,
} from '@invoke-ai/ui-library';
import { useAppSelector } from 'app/store/storeHooks';
import { selectCurrentUser } from 'features/auth/store/authSlice';
import { selectCanvasSessionId } from 'features/controlLayers/store/canvasStagingAreaSlice';
import QueueStatusBadge from 'features/queue/components/common/QueueStatusBadge';
import { useCancelQueueItem } from 'features/queue/hooks/useCancelQueueItem';
import { getSecondsFromTimestamps } from 'features/queue/util/getSecondsFromTimestamps';
import { toast } from 'features/toast/toast';
import { useAutoLayoutContext } from 'features/ui/layouts/auto-layout-context';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PiImagesBold, PiXBold } from 'react-icons/pi';
import {
  queueApi,
  type SessionQueueItemStatus,
  useCancelByBatchIdsMutation,
} from 'services/api/endpoints/queue';
import type { S } from 'services/api/types';

const ACTIVE_STATUSES = new Set<SessionQueueItemStatus>(['pending', 'in_progress']);
const TERMINAL_STATUSES = new Set<SessionQueueItemStatus>(['completed', 'failed', 'canceled']);
const EXTERNAL_GENERATION_NODE_TYPES = new Set([
  'alibabacloud_image_generation',
  'gemini_image_generation',
  'openai_image_generation',
  'seedream_image_generation',
]);
const RECENT_ITEM_WINDOW_MS = 30 * 60 * 1000;
const MAX_VISIBLE_ITEMS = 50;

const emptyItems: S['SessionQueueItem'][] = [];

const listAllQueueItemsQueryOptions = {
  pollingInterval: 5000,
  refetchOnFocus: true,
  refetchOnReconnect: true,
};

export const GenerationQueueTasks = memo(() => {
  const { tab } = useAutoLayoutContext();

  if (tab !== 'generate' && tab !== 'canvas') {
    return null;
  }

  return <GenerationQueueTasksContent tab={tab} />;
});
GenerationQueueTasks.displayName = 'GenerationQueueTasks';

const GenerationQueueTasksContent = memo(({ tab }: { tab: 'generate' | 'canvas' }) => {
  const { t } = useTranslation();
  const currentUser = useAppSelector(selectCurrentUser);
  const canvasSessionId = useAppSelector(selectCanvasSessionId);
  const [now, setNow] = useState(() => Date.now());

  const generateQuery = queueApi.endpoints.listAllQueueItems.useQuery(
    { destination: 'generate' },
    {
      ...listAllQueueItemsQueryOptions,
      skip: tab !== 'generate',
    }
  );

  const canvasGalleryQuery = queueApi.endpoints.listAllQueueItems.useQuery(
    { destination: 'canvas' },
    {
      ...listAllQueueItemsQueryOptions,
      skip: tab !== 'canvas',
    }
  );

  const canvasStagingQuery = queueApi.endpoints.listAllQueueItems.useQuery(
    { destination: canvasSessionId },
    {
      ...listAllQueueItemsQueryOptions,
      skip: tab !== 'canvas',
    }
  );

  const items = useMemo(() => {
    const sourceItems =
      tab === 'generate'
        ? generateQuery.data ?? emptyItems
        : [...(canvasGalleryQuery.data ?? emptyItems), ...(canvasStagingQuery.data ?? emptyItems)];

    const byId = new Map<number, S['SessionQueueItem']>();
    for (const item of sourceItems) {
      if (!isExternalGenerationQueueItem(item)) {
        continue;
      }
      if (!currentUser?.is_admin && item.user_id !== currentUser?.user_id) {
        continue;
      }
      const isRecent = now - new Date(item.updated_at ?? item.created_at).getTime() <= RECENT_ITEM_WINDOW_MS;
      if (!ACTIVE_STATUSES.has(item.status) && !isRecent) {
        continue;
      }
      byId.set(item.item_id, item);
    }

    return Array.from(byId.values())
      .sort((a, b) => b.item_id - a.item_id)
      .slice(0, MAX_VISIBLE_ITEMS);
  }, [
    canvasGalleryQuery.data,
    canvasStagingQuery.data,
    currentUser?.is_admin,
    currentUser?.user_id,
    generateQuery.data,
    now,
    tab,
  ]);

  const activeItems = useMemo(() => items.filter((item) => ACTIVE_STATUSES.has(item.status)), [items]);
  const activeBatchIds = useMemo(
    () => Array.from(new Set(activeItems.map((item) => item.batch_id))).filter(Boolean),
    [activeItems]
  );
  const [cancelByBatchIds, cancelByBatchIdsState] = useCancelByBatchIdsMutation({
    fixedCacheKey: 'cancelVisibleGenerationBatches',
  });

  useEffect(() => {
    if (!activeItems.length) {
      return;
    }
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(interval);
    };
  }, [activeItems.length]);

  const onCancelActiveBatches = useCallback(async () => {
    if (!activeBatchIds.length) {
      return;
    }
    try {
      await cancelByBatchIds({ batch_ids: activeBatchIds }).unwrap();
      toast({
        id: 'CANCEL_GENERATION_BATCHES_SUCCEEDED',
        title: t('queue.cancelBatchSucceeded'),
        status: 'success',
      });
    } catch {
      toast({
        id: 'CANCEL_GENERATION_BATCHES_FAILED',
        title: t('queue.cancelBatchFailed'),
        status: 'error',
      });
    }
  }, [activeBatchIds, cancelByBatchIds, t]);

  const isInitialLoading =
    tab === 'generate'
      ? generateQuery.isLoading
      : canvasGalleryQuery.isLoading || canvasStagingQuery.isLoading;
  const isFetching =
    tab === 'generate'
      ? generateQuery.isFetching
      : canvasGalleryQuery.isFetching || canvasStagingQuery.isFetching;

  if (!items.length && !isInitialLoading) {
    return null;
  }

  return (
    <Flex layerStyle="second" flexDir="column" gap={2} p={2} borderRadius="base" flexShrink={0} maxH="36%">
      <Flex alignItems="center" gap={2}>
        <PiImagesBold />
        <Heading size="sm">{t('queue.generationTasks')}</Heading>
        <Badge colorScheme={activeItems.length ? 'yellow' : 'base'}>
          {activeItems.length
            ? t('queue.activeTasks', { count: activeItems.length })
            : t('queue.recentTasks', { count: items.length })}
        </Badge>
        {isFetching && <Spinner size="xs" opacity={0.6} />}
        <Flex flexGrow={1} />
        <Button
          size="xs"
          variant="ghost"
          colorScheme="error"
          leftIcon={<PiXBold />}
          onClick={onCancelActiveBatches}
          isDisabled={!activeBatchIds.length}
          isLoading={cancelByBatchIdsState.isLoading}
        >
          {t('queue.cancelActiveBatches')}
        </Button>
      </Flex>
      <Divider />
      <Flex flexDir="column" gap={1} overflowY="auto" minH={0}>
        {items.map((item, index) => (
          <GenerationQueueTaskRow key={item.item_id} item={item} index={index} now={now} />
        ))}
      </Flex>
    </Flex>
  );
});
GenerationQueueTasksContent.displayName = 'GenerationQueueTasksContent';

const GenerationQueueTaskRow = memo(({ item, index, now }: { item: S['SessionQueueItem']; index: number; now: number }) => {
  const { t } = useTranslation();
  const cancelQueueItem = useCancelQueueItem();
  const isTerminal = TERMINAL_STATUSES.has(item.status);
  const canCancel = !isTerminal;
  const prompt = useMemo(() => getPromptPreview(item), [item]);
  const timing = useMemo(() => getTimingText(item, now, t), [item, now, t]);

  const onCancel = useCallback(() => {
    cancelQueueItem.trigger(item.item_id);
  }, [cancelQueueItem, item.item_id]);

  return (
    <Flex
      layerStyle="first"
      borderRadius="base"
      minH={10}
      alignItems="center"
      gap={3}
      px={2}
      py={1.5}
      fontSize="sm"
    >
      <Text color="base.400" w={7} textAlign="end" flexShrink={0}>
        {index + 1}
      </Text>
      <Flex w="6rem" flexShrink={0}>
        <QueueStatusBadge status={item.status} />
      </Flex>
      <Text color="base.400" w="5rem" flexShrink={0}>
        #{item.item_id}
      </Text>
      <Text flexGrow={1} minW={0} noOfLines={1} title={prompt}>
        {prompt || t('queue.noPromptPreview')}
      </Text>
      <Text color="base.300" w="6rem" flexShrink={0} textAlign="end">
        {timing}
      </Text>
      <ButtonGroup size="xs" variant="ghost" flexShrink={0}>
        <IconButton
          aria-label={t('queue.cancelItem')}
          tooltip={t('queue.cancelItem')}
          icon={<PiXBold />}
          colorScheme="error"
          onClick={onCancel}
          isDisabled={!canCancel || cancelQueueItem.isDisabled}
          isLoading={cancelQueueItem.isLoading}
        />
      </ButtonGroup>
    </Flex>
  );
});
GenerationQueueTaskRow.displayName = 'GenerationQueueTaskRow';

const getPromptPreview = (item: S['SessionQueueItem']) => {
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
  return Object.values(item.session.graph.nodes ?? {}).some((node) => EXTERNAL_GENERATION_NODE_TYPES.has(node.type));
};

const getTimingText = (item: S['SessionQueueItem'], now: number, t: ReturnType<typeof useTranslation>['t']) => {
  if (item.completed_at && item.started_at) {
    return `${getSecondsFromTimestamps(item.started_at, item.completed_at)}s`;
  }

  const startedAt = item.started_at ?? item.created_at;
  if (item.status === 'in_progress' || item.status === 'pending') {
    const seconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
    return `${seconds}s`;
  }

  return t(`queue.${item.status}`);
};
