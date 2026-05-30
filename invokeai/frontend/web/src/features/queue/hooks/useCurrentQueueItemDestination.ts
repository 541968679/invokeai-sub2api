import { useGetCurrentQueueItemsQuery } from 'services/api/endpoints/queue';

export const useCurrentQueueItemDestination = () => {
  const { currentQueueItemDestination } = useGetCurrentQueueItemsQuery(undefined, {
    selectFromResult: ({ data }) => ({
      currentQueueItemDestination: data?.[0]?.destination ?? null,
    }),
  });

  return currentQueueItemDestination;
};
