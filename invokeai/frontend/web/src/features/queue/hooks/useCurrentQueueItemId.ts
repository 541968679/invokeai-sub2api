import { useGetCurrentQueueItemsQuery } from 'services/api/endpoints/queue';

export const useCurrentQueueItemId = () => {
  const { currentQueueItemId } = useGetCurrentQueueItemsQuery(undefined, {
    selectFromResult: ({ data }) => ({
      currentQueueItemId: data?.[0]?.item_id ?? null,
    }),
  });

  return currentQueueItemId;
};
