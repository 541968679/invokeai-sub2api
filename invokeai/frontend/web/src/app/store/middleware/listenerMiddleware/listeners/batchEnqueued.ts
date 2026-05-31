import { logger } from 'app/logging/logger';
import type { AppStartListening } from 'app/store/store';
import { truncate } from 'es-toolkit/compat';
import { zPydanticValidationError } from 'features/system/store/zodSchemas';
import { toast } from 'features/toast/toast';
import { t } from 'i18next';
import { serializeError } from 'serialize-error';
import { LIST_ALL_TAG } from 'services/api';
import { queueApi } from 'services/api/endpoints/queue';
import type { S } from 'services/api/types';
import type { JsonObject } from 'type-fest';

const log = logger('queue');

export const addBatchEnqueuedListener = (startAppListening: AppStartListening) => {
  // success
  startAppListening({
    matcher: queueApi.endpoints.enqueueBatch.matchFulfilled,
    effect: async (action, { dispatch }) => {
      const enqueueResult = action.payload;
      const arg = action.meta.arg.originalArgs;
      log.debug({ enqueueResult } as JsonObject, 'Batch enqueued');

      toast({
        id: 'QUEUE_BATCH_SUCCEEDED',
        title: t('queue.batchQueued'),
        status: 'success',
        description: t('queue.batchQueuedDesc', {
          count: enqueueResult.enqueued,
          direction: arg.prepend ? t('queue.front') : t('queue.back'),
        }),
      });

      if (!enqueueResult.item_ids.length) {
        return;
      }

      try {
        const queueItems = await dispatch(
          queueApi.endpoints.getQueueItemDTOsByItemIds.initiate({ item_ids: enqueueResult.item_ids }, { track: false })
        ).unwrap();

        dispatch(
          queueApi.util.updateQueryData('listAllQueueItems', undefined, (draft) => {
            mergeQueueItemsIntoDraft(draft, queueItems);
          })
        );

        const destination = arg.batch.destination;
        if (destination) {
          dispatch(
            queueApi.util.updateQueryData('listAllQueueItems', { destination }, (draft) => {
              mergeQueueItemsIntoDraft(
                draft,
                queueItems.filter((item) => item.destination === destination)
              );
            })
          );
        }
      } catch (error) {
        log.debug({ error: serializeError(error) } as JsonObject, 'Failed to hydrate enqueued queue items');
        dispatch(queueApi.util.invalidateTags([{ type: 'SessionQueueItem', id: LIST_ALL_TAG }]));
      }
    },
  });

  // error
  startAppListening({
    matcher: queueApi.endpoints.enqueueBatch.matchRejected,
    effect: (action) => {
      const response = action.payload;
      const batchConfig = action.meta.arg.originalArgs;

      if (!response) {
        toast({
          id: 'QUEUE_BATCH_FAILED',
          title: t('queue.batchFailedToQueue'),
          status: 'error',
          description: t('common.unknownError'),
        });
        log.error({ batchConfig } as JsonObject, t('queue.batchFailedToQueue'));
        return;
      }

      const result = zPydanticValidationError.safeParse(response);
      if (result.success) {
        result.data.data.detail.map((e) => {
          const description = truncate(e.msg.replace(/^(Value|Index|Key) error, /i, ''), { length: 256 });
          toast({
            id: 'QUEUE_BATCH_FAILED',
            title: t('queue.batchFailedToQueue'),
            status: 'error',
            description,
          });
        });
      } else if (response.status !== 403) {
        toast({
          id: 'QUEUE_BATCH_FAILED',
          title: t('queue.batchFailedToQueue'),
          status: 'error',
          description: t('common.unknownError'),
        });
      }
      log.error({ batchConfig, error: serializeError(response) } as JsonObject, t('queue.batchFailedToQueue'));
    },
  });
};

const mergeQueueItemsIntoDraft = (draft: S['SessionQueueItem'][], queueItems: S['SessionQueueItem'][]) => {
  for (const queueItem of queueItems) {
    const existingIndex = draft.findIndex((item) => item.item_id === queueItem.item_id);
    if (existingIndex >= 0) {
      draft[existingIndex] = queueItem;
    } else {
      draft.unshift(queueItem);
    }
  }

  draft.sort((a, b) => b.item_id - a.item_id);
};
