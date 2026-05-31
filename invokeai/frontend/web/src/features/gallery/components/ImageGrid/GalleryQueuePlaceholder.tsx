import { Box, Flex, IconButton, Spinner, Text } from '@invoke-ai/ui-library';
import { getQueueItemPromptPreview } from 'features/gallery/components/use-gallery-queue-placeholders';
import QueueStatusBadge from 'features/queue/components/common/QueueStatusBadge';
import { useCancelQueueItem } from 'features/queue/hooks/useCancelQueueItem';
import { getTimestampMillis } from 'features/queue/util/getSecondsFromTimestamps';
import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PiClockBold, PiXBold } from 'react-icons/pi';
import type { S } from 'services/api/types';

import { galleryItemContainerSX } from './galleryItemContainerSX';

type Props = {
  item: S['SessionQueueItem'];
  now: number;
};

export const GalleryQueuePlaceholder = memo(({ item, now }: Props) => {
  const { t } = useTranslation();
  const cancelQueueItem = useCancelQueueItem();
  const prompt = useMemo(() => getQueueItemPromptPreview(item), [item]);
  const elapsedSeconds = useMemo(() => getElapsedSeconds(item, now), [item, now]);

  const onCancel = useCallback(() => {
    cancelQueueItem.trigger(item.item_id);
  }, [cancelQueueItem, item.item_id]);

  return (
    <Flex sx={galleryItemContainerSX} data-item-id={`queue-placeholder-${item.item_id}`}>
      <Flex
        w="full"
        h="full"
        bg="base.850"
        borderRadius="base"
        borderWidth={1}
        borderColor={item.status === 'in_progress' ? 'invokeYellow.500' : 'base.700'}
        alignItems="center"
        justifyContent="center"
        flexDir="column"
        position="relative"
        overflow="hidden"
        p={2}
        gap={2}
      >
        <Box
          position="absolute"
          inset={0}
          bgGradient="linear(to-br, base.800, base.900)"
          opacity={0.78}
          pointerEvents="none"
        />
        <Flex position="relative" w="full" alignItems="center" gap={2} minH={6} flexShrink={0}>
          <Flex minW={0} overflow="hidden">
            <QueueStatusBadge status={item.status} />
          </Flex>
          <Text color="base.400" fontSize="xs" noOfLines={1} flexShrink={0}>
            #{item.item_id}
          </Text>
          <Box flexGrow={1} minW={0} />
          <IconButton
            aria-label={t('queue.cancelItem')}
            tooltip={t('queue.cancelItem')}
            icon={<PiXBold />}
            size="xs"
            variant="ghost"
            colorScheme="error"
            onClick={onCancel}
            isDisabled={cancelQueueItem.isDisabled}
            isLoading={cancelQueueItem.isLoading}
          />
        </Flex>
        <Flex
          position="relative"
          flexDir="column"
          alignItems="center"
          justifyContent="center"
          gap={2}
          minW={0}
          minH={0}
          flexGrow={1}
          w="full"
        >
          <Spinner size="lg" opacity={0.8} />
          <Flex alignItems="center" gap={1.5} color="base.200" fontSize="sm" minW={0} maxW="full">
            <PiClockBold />
            <Text noOfLines={1}>{t('queue.elapsedSeconds', { count: elapsedSeconds })}</Text>
          </Flex>
          <Text
            color="base.200"
            fontSize="sm"
            lineHeight="short"
            textAlign="center"
            noOfLines={2}
            title={prompt}
            wordBreak="break-word"
            maxW="full"
          >
            {prompt || t('queue.noPromptPreview')}
          </Text>
        </Flex>
      </Flex>
    </Flex>
  );
});
GalleryQueuePlaceholder.displayName = 'GalleryQueuePlaceholder';

const getElapsedSeconds = (item: S['SessionQueueItem'], now: number) => {
  const start = item.started_at ?? item.created_at;
  const startMillis = getTimestampMillis(start);
  if (startMillis === null) {
    return 0;
  }
  return Math.max(0, Math.floor((now - startMillis) / 1000));
};
