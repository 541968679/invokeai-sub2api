import type { SystemStyleObject } from '@invoke-ai/ui-library';
import { Box, Center, Text } from '@invoke-ai/ui-library';
import { useAppSelector } from 'app/store/storeHooks';
import { useIsModelManagerEnabled } from 'features/modelManagerV2/hooks/useIsModelManagerEnabled';
import { selectSelectedModelKey, selectSelectedPanel } from 'features/modelManagerV2/store/modelManagerV2Slice';
import { ExternalProvidersForm } from 'features/modelManagerV2/subpanels/AddModelPanel/ExternalProviders/ExternalProvidersForm';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { InstallModels } from './InstallModels';
import { Model } from './ModelPanel/Model';

const modelPaneSx: SystemStyleObject = {
  layerStyle: 'first',
  p: 4,
  borderRadius: 'base',
  w: {
    base: '50%',
    lg: '75%',
    '2xl': '85%',
  },
  h: 'full',
  minWidth: '300px',
  overflow: 'auto',
};

export const ModelPane = memo(() => {
  const selectedModelKey = useAppSelector(selectSelectedModelKey);
  const selectedPanel = useAppSelector(selectSelectedPanel);
  const canManageModels = useIsModelManagerEnabled();
  const { t } = useTranslation();

  if (selectedPanel === 'externalProviders') {
    return (
      <Box sx={modelPaneSx}>
        <ExternalProvidersForm installProviderModelsOnSave={false} showFooter />
      </Box>
    );
  }

  // Show model details if a model is selected
  if (selectedModelKey) {
    return (
      <Box sx={modelPaneSx}>
        <Model key={selectedModelKey} />
      </Box>
    );
  }

  // Show install panel for users with model management permissions, empty state for others
  if (canManageModels) {
    return (
      <Box sx={modelPaneSx}>
        <InstallModels />
      </Box>
    );
  }

  // Empty state for users without model management permissions
  return (
    <Box sx={modelPaneSx}>
      <Center h="full">
        <Text fontSize="lg" color="base.500">
          {t('modelManager.selectModelToView')}
        </Text>
      </Center>
    </Box>
  );
});

ModelPane.displayName = 'ModelPane';
