import { CompositeNumberInput } from '@invoke-ai/ui-library';
import { useAppDispatch, useAppSelector } from 'app/store/storeHooks';
import { InformationalPopover } from 'common/components/InformationalPopover/InformationalPopover';
import { selectIsExternal, selectIterations, setIterations } from 'features/controlLayers/store/paramsSlice';
import { memo, useCallback, useMemo } from 'react';

export const QueueIterationsNumberInput = memo(() => {
  const iterations = useAppSelector(selectIterations);
  const isExternal = useAppSelector(selectIsExternal);
  const dispatch = useAppDispatch();
  const handleChange = useCallback(
    (v: number) => {
      dispatch(setIterations(v));
    },
    [dispatch]
  );
  const max = useMemo(() => (isExternal ? 100 : 10000), [isExternal]);

  return (
    <InformationalPopover feature="paramIterations">
      <CompositeNumberInput
        step={1}
        fineStep={1}
        min={1}
        max={max}
        onChange={handleChange}
        value={iterations}
        defaultValue={1}
        pos="absolute"
        insetInlineEnd={0}
        h="full"
        ps={0}
        w="72px"
        flexShrink={0}
        variant="iterations"
      />
    </InformationalPopover>
  );
});

QueueIterationsNumberInput.displayName = 'QueueIterationsNumberInput';
