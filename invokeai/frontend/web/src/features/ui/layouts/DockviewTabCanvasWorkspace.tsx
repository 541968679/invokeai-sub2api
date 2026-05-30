import { Flex, Text } from '@invoke-ai/ui-library';
import { useAppSelector } from 'app/store/storeHooks';
import { setFocusedRegion } from 'common/hooks/focus';
import { useCallbackOnDragEnter } from 'common/hooks/useCallbackOnDragEnter';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { selectCanvasSessionId } from 'features/controlLayers/store/canvasStagingAreaSlice';
import ProgressBar from 'features/system/components/ProgressBar';
import { memo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useGetQueueCountsByDestinationQuery } from 'services/api/endpoints/queue';

import type { DockviewPanelParameters } from './auto-layout-context';

export const DockviewTabCanvasWorkspace = memo((props: IDockviewPanelHeaderProps<DockviewPanelParameters>) => {
  const { t } = useTranslation();
  const canvasSessionId = useAppSelector(selectCanvasSessionId);
  const { hasActiveItems } = useGetQueueCountsByDestinationQuery(
    { destination: canvasSessionId },
    {
      selectFromResult: ({ data }) => ({
        hasActiveItems: Boolean(data && data.pending + data.in_progress > 0),
      }),
    }
  );

  const ref = useRef<HTMLDivElement>(null);
  const setActive = useCallback(() => {
    if (!props.api.isActive) {
      props.api.setActive();
    }
  }, [props.api]);

  useCallbackOnDragEnter(setActive, ref, 300);

  const onPointerDown = useCallback(() => {
    setFocusedRegion(props.params.focusRegion);
  }, [props.params.focusRegion]);

  return (
    <Flex ref={ref} position="relative" alignItems="center" h="full" onPointerDown={onPointerDown}>
      <Text userSelect="none" px={4}>
        {t(props.params.i18nKey)}
      </Text>
      {hasActiveItems && (
        <ProgressBar position="absolute" bottom={0} left={0} right={0} h={1} borderRadius="none" />
      )}
    </Flex>
  );
});
DockviewTabCanvasWorkspace.displayName = 'DockviewTabCanvasWorkspace';
